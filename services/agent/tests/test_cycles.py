"""サイクルとプロダクトレビュー：全工程が100%になったらレビューに入り、定期実行を止める。PdM が戦略と追加指示を
書くと次のサイクルが始まり、%は0に戻り、PM が先に工程ごとの目標を決めて担当に Issue を出し、担当が動く。"""

import datetime as dt
import importlib
import time

import pytest
from fastapi.testclient import TestClient

H = {"x-pf-internal-token": "t", "x-pf-user": "owner@example.com", "x-pf-tenant": "tenant-a", "x-pf-role": "OWNER"}
VIEWER = {**H, "x-pf-role": "VIEWER"}


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/y.db")
    monkeypatch.setenv("PF_INTERNAL_TOKEN", "t")
    monkeypatch.setenv("PF_LLM", "stub")
    monkeypatch.delenv("K_SERVICE", raising=False)
    from pf_agent import api, db

    importlib.reload(db)
    importlib.reload(api)
    with TestClient(api.app) as c:
        pid = c.post("/products", headers=H, json={"name": "回る", "idea": "家計簿"}).json()["id"]
        from pf_agent.db import Product, session

        with session() as s:
            p = s.get(Product, pid)
            s.expunge(p)
        yield c, p


def wait_idle(c, pid):
    for _ in range(300):
        js = c.get(f"/jobs?product={pid}", headers=H).json()
        rows = js if isinstance(js, list) else js.get("runs", js.get("items", []))
        if not any(r["status"] in ("queued", "running") for r in rows):
            return
        time.sleep(0.1)
    raise AssertionError("jobs still running")


def finish_all(p):
    """全工程を100%にする（必須を埋め、担当の報告を100%に）。"""
    from pf_agent import fwlib, llm, repo, team
    from pf_agent.db import TeamAgent, session
    from pf_agent.stages import STAGES

    team.ensure(p)
    for st in STAGES:
        for f in fwlib.of(p.id, st.id).fields:
            if f.required:
                repo.set_field(p.id, st.id, f.key, llm._stub_value(f, "家計簿"), "t", "test")
    with session() as s:
        for a in s.query(TeamAgent).filter_by(product_id=p.id).all():
            if a.key.startswith("s"):
                a.report = {"progress": 100, "health": "green", "summary": "終わり"}
        s.commit()


def test_cycle_review_and_next(env):
    from pf_agent import cycles, issues, team
    from pf_agent.db import AssistantMessage, TeamAgent, session

    c, p = env
    P = f"/products/{p.id}"
    st = c.get(P + "/cycle", headers=H).json()
    assert st["cycle"] == 1 and st["state"] == "running" and not st["progress"]["complete"]
    # 必須が空のまま100%と報告しても、100%とはみなさない
    team.ensure(p)
    with session() as s:
        for a in s.query(TeamAgent).filter_by(product_id=p.id).all():
            a.report = {"progress": 100}
        s.commit()
    assert not cycles.progress(p.id)["complete"] and cycles.check_all() == []
    # 全工程が100%になったら、定期実行の中でレビューに入り、PdM に知らせる
    finish_all(p)
    assert cycles.check_all() == [p.id]
    st = c.get(P + "/cycle", headers=H).json()
    assert st["state"] == "review" and st["current"]["snapshot"]["s01"] == 100
    with session() as s:
        m = s.query(AssistantMessage).filter_by(product_id=p.id, agent="platform").all()[-1]
    assert m.text.startswith("【プロダクトレビュー】サイクル 1") and m.context["link"].endswith("/review")
    # レビュー中は動かさない（今すぐ動かす・定期実行とも）。予定の時刻だけ進む
    assert c.post(P + "/team/run", headers=H, json={"keys": ["pm_biz"]}).status_code == 409
    with session() as s:
        for a in s.query(TeamAgent).filter_by(product_id=p.id).all():
            a.next_run_at = dt.datetime.now(dt.UTC) - dt.timedelta(minutes=1)
        s.commit()
    assert team.tick() == []
    with session() as s:
        now = dt.datetime.now(dt.UTC).replace(tzinfo=None)
        assert all(a.next_run_at.replace(tzinfo=None) > now for a in s.query(TeamAgent).filter_by(product_id=p.id))
    # レビュー画面：全工程の成果物
    r = c.get(P + "/review", headers=H).json()
    assert len(r["deliverables"]) == 14 and r["deliverables"][0]["markdown"] and r["deliverables"][0]["pct"] == 100
    # 次のサイクル：戦略が要る。閲覧のみは始められない
    body = {"strategy": "継続率を上げる。家族で共有する機能を足す", "directives": {"pm_biz": "競合の共有機能を調べる"},
            "notes": "入力が面倒という声が多い"}
    assert c.post(P + "/review/next", headers=H, json={**body, "strategy": " "}).status_code == 422
    assert c.post(P + "/review/next", headers=VIEWER, json=body).status_code == 403
    r = c.post(P + "/review/next", headers=H, json=body).json()
    assert r["cycle"] == 2 and r["state"] == "running" and r["progress"]["total"] == 0 and r["job_id"]
    wait_idle(c, p.id)
    # PM が工程ごとの目標を決め、担当に Issue を出し、担当が動いた
    st = c.get(P + "/cycle", headers=H).json()
    goals = st["current"]["goals"]
    assert set(goals) == {f"s{i:02d}" for i in range(1, 15)} and goals["s01"]["by"] == "pm_biz"
    assert st["past"][0]["number"] == 1 and st["past"][0]["review_notes"] == "入力が面倒という声が多い"
    mine = [i for i in issues.search(p) if i["subject"].startswith("サイクル 2 の目標")]
    assert len(mine) == 14 and all(i["author"].startswith("pm_") for i in mine)
    s01 = next(i for i in mine if i["stage_id"] == "s01")
    assert any(j["author"] == "s01" for j in issues.get(p, s01["number"])["journals"])
    # 工程の画面にも、このサイクルの目標が出る
    d = c.get(P + "/stages/s01", headers=H).json()
    assert d["cycle_goal"]["cycle"] == 2 and "家族で共有" in d["cycle_goal"]["strategy"]
    # 手動でもレビューを始められる。二重には始められない
    assert c.post(P + "/review/start", headers=H).json()["state"] == "review"
    assert c.post(P + "/review/start", headers=H).status_code == 409


def test_cycle_plan(env):
    """サイクル数と位置付けは PdM が決める。位置付けは AI の指示と工程の画面に入り、
    計画を超えるときは位置付けを書いて足す。"""
    from pf_agent import cycles, team

    c, p = env
    P = f"/products/{p.id}"
    st = c.get(P + "/cycle", headers=H).json()
    assert st["plan"] == [{"label": "MVP", "purpose": "", "exit": ""}] and not st["planned"] and len(st["example"]) == 3
    items = [{"label": "PoC用プロトタイプ", "purpose": "仮説を確かめる", "exit": "続けるかを決められる"},
             {"label": "MVP", "purpose": "最初の利用者に届ける"}]
    assert c.put(P + "/cycle-plan", headers=VIEWER, json={"items": items}).status_code == 403
    assert c.put(P + "/cycle-plan", headers=H, json={"items": [{"label": " "}]}).status_code == 422
    st = c.put(P + "/cycle-plan", headers=H, json={"items": items}).json()
    assert st["planned"] and st["current"]["label"] == "PoC用プロトタイプ"
    assert "続けるかを決められる" in st["current"]["purpose"]
    # 位置付けは担当の指示（プロンプト）と工程の画面に入る
    assert "位置付け：PoC用プロトタイプ" in team._goal_md(p.id, "s01")
    assert c.get(P + "/stages/s01", headers=H).json()["cycle_goal"]["label"] == "PoC用プロトタイプ"
    # サイクル 2 は計画の MVP
    finish_all(p)
    cycles.check_all()
    r = c.post(P + "/review/next", headers=H, json={"strategy": "最初の利用者に出す"}).json()
    assert r["current"]["label"] == "MVP" and r["past"][0]["label"] == "PoC用プロトタイプ"
    wait_idle(c, p.id)
    assert "MVP" in r["current"]["label"]
    # 今のサイクルより短い計画にはできない
    assert c.put(P + "/cycle-plan", headers=H, json={"items": items[:1]}).status_code == 422
    # 計画を超える：位置付けを書かないと始められない。書くと計画に足す
    c.post(P + "/review/start", headers=H)
    assert c.post(P + "/review/next", headers=H, json={"strategy": "売る"}).status_code == 422
    r = c.post(P + "/review/next", headers=H, json={"strategy": "売る", "label": "MMP"}).json()
    assert r["cycle"] == 3 and r["current"]["label"] == "MMP"
    assert [x["label"] for x in r["plan"]] == ["PoC用プロトタイプ", "MVP", "MMP"]
    wait_idle(c, p.id)
