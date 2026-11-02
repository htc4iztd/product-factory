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
        if st.id == "s14":  # ⑭リリースはサイクルの外（空のままでもサイクルは終わる）
            continue
        for f in fwlib.of(p.id, st.id).fields:
            if f.required:
                repo.set_field(p.id, st.id, f.key, llm._stub_value(f, "家計簿"), "t", "test")
    with session() as s:
        for a in s.query(TeamAgent).filter_by(product_id=p.id).all():
            if a.key.startswith("s") and a.key != "s14":
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
    # ①〜⑬が100%になったら（⑭は外）、定期実行の中でレビューに入り、PM がレビューする
    finish_all(p)
    assert cycles.progress(p.id)["complete"] and "s14" not in {x["id"] for x in cycles.progress(p.id)["stages"]}
    assert cycles.check_all() == [p.id]
    wait_idle(c, p.id)
    st = c.get(P + "/cycle", headers=H).json()
    assert st["state"] == "review" and st["current"]["snapshot"]["s01"] == 100
    rnd = st["current"]["review"]["rounds"][0]
    assert rnd["n"] == 1 and rnd["status"] == "ready" and set(rnd["pm"]) == {"pm_biz", "pm_design", "pm_impl"}
    with session() as s:
        msgs = [m.text for m in s.query(AssistantMessage).filter_by(product_id=p.id, agent="platform").all()]
    assert any(t.startswith("【プロダクトレビュー】サイクル 1") for t in msgs)
    assert any("第 1 回の PM のレビューが出ました" in t for t in msgs)
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
    # レビュー画面：サイクルの成果物（①〜⑬）
    r = c.get(P + "/review", headers=H).json()
    assert len(r["deliverables"]) == 13 and r["deliverables"][0]["markdown"] and r["deliverables"][0]["pct"] == 100
    # PdM が PM に修正を指示 → PM が担当に Issue → 担当が直す → 回が「直った」になる
    assert c.post(P + "/review/fix", headers=H, json={"directives": {}}).status_code == 422
    r = c.post(P + "/review/fix", headers=H, json={"notes": "家族の共有が弱い",
                                                   "directives": {"pm_biz": "④に家族で共有する価値を足す"}}).json()
    fx_ = r["current"]["review"]["rounds"][0]["fixes"][0]
    assert fx_["pm"] == "pm_biz" and fx_["issues"]
    assert c.post(P + "/review/complete", headers=H, json={"next": "skip"}).status_code == 409  # 修正中は完了できない
    wait_idle(c, p.id)
    cycles.check_all()
    st = c.get(P + "/cycle", headers=H).json()
    assert st["current"]["review"]["rounds"][0]["status"] == "fixed"
    # もう一度 PM にレビューさせる（第 2 回）
    c.post(P + "/review/again", headers=H)
    wait_idle(c, p.id)
    st = c.get(P + "/cycle", headers=H).json()
    assert [x["n"] for x in st["current"]["review"]["rounds"]] == [1, 2]
    assert st["current"]["review"]["rounds"][1]["status"] == "ready"
    # まだ次のサイクルは始められない（レビューを完了してから）
    assert c.post(P + "/review/next", headers=H, json={"strategy": "x"}).status_code == 409
    # リリースせずに完了 → サイクル完了
    assert c.post(P + "/review/complete", headers=H, json={"next": "skip"}).json()["state"] == "done"
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
    assert set(goals) == {f"s{i:02d}" for i in range(1, 14)} and goals["s01"]["by"] == "pm_biz"  # ⑭は外
    assert st["past"][0]["number"] == 1 and st["past"][0]["review_notes"] == "入力が面倒という声が多い"
    mine = [i for i in issues.search(p) if i["subject"].startswith("サイクル 2 の目標")]
    assert len(mine) == 13 and all(i["author"].startswith("pm_") for i in mine)
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
    wait_idle(c, p.id)
    c.post(P + "/review/complete", headers=H, json={"next": "skip"})
    r = c.post(P + "/review/next", headers=H, json={"strategy": "最初の利用者に出す"}).json()
    assert r["current"]["label"] == "MVP" and r["past"][0]["label"] == "PoC用プロトタイプ"
    wait_idle(c, p.id)
    assert "MVP" in r["current"]["label"]
    # 今のサイクルより短い計画にはできない
    assert c.put(P + "/cycle-plan", headers=H, json={"items": items[:1]}).status_code == 422
    # 計画を超える：位置付けを書かないと始められない。書くと計画に足す
    c.post(P + "/review/start", headers=H)
    wait_idle(c, p.id)
    c.post(P + "/review/complete", headers=H, json={"next": "skip"})
    assert c.post(P + "/review/next", headers=H, json={"strategy": "売る"}).status_code == 422
    r = c.post(P + "/review/next", headers=H, json={"strategy": "売る", "label": "MMP"}).json()
    assert r["cycle"] == 3 and r["current"]["label"] == "MMP"
    assert [x["label"] for x in r["plan"]] == ["PoC用プロトタイプ", "MVP", "MMP"]
    wait_idle(c, p.id)


def test_release_after_review(env, monkeypatch):
    """プロダクトレビューを完了してリリースに進む → リリースエージェントが定義 → PdM がレビュー・承認
    → 接続先でリリース。"""
    from pf_agent import cycles, releases, repo

    c, p = env
    P = f"/products/{p.id}"
    finish_all(p)
    cycles.check_all()
    wait_idle(c, p.id)
    r = c.post(P + "/review/complete", headers=H, json={"next": "release"}).json()
    assert r["state"] == "onboarding"
    wait_idle(c, p.id)
    v = c.get(P + "/release", headers=H).json()
    assert v["state"] == "prerelease" and v["current"]["release"]["status"] == "review"
    plan = v["current"]["release"]["plan"]
    assert plan["environment"]["kind"] == "cloud" and plan["method"]["strategy"] and plan["steps"]
    # 直させる → もう一度定義（前の定義は履歴に残る）
    assert c.post(P + "/release/changes", headers=H, json={"feedback": " "}).status_code == 422
    c.post(P + "/release/changes", headers=H, json={"feedback": "オンプレも比べて"})
    wait_idle(c, p.id)
    v = c.get(P + "/release", headers=H).json()
    assert v["state"] == "prerelease" and v["current"]["release"]["history"][0]["feedback"] == "オンプレも比べて"
    # 接続先がないと承認できない。Webhook は https だけ
    assert c.post(P + "/release/approve", headers=H).status_code == 409
    assert c.put(P + "/release/target", headers=H, json={"kind": "webhook", "url": "http://x"}).status_code == 422
    assert c.put(P + "/release/target", headers=VIEWER, json={"kind": "manual"}).status_code == 403
    c.put(P + "/release/target", headers=H, json={"kind": "webhook", "url": "https://cd.example.com/hook"})
    c.put(P + "/release/secret", headers=H, json={"secret": "s3cret"})
    sent = []

    def fake_post(url, body, headers):
        sent.append((url, body, headers))
        return 202, "accepted"
    monkeypatch.setattr(releases, "_post", fake_post)
    assert c.post(P + "/release/approve", headers=H).json()["state"] == "releasing"
    wait_idle(c, p.id)
    v = c.get(P + "/release", headers=H).json()
    assert v["state"] == "done" and v["current"]["release"]["status"] == "released"
    url, body, headers = sent[0]
    import hashlib
    import hmac
    import json as js

    assert url == "https://cd.example.com/hook" and js.loads(body)["plan"]["method"]
    assert headers["x-pf-signature"] == "sha256=" + hmac.new(b"s3cret", body, hashlib.sha256).hexdigest()
    assert "サイクル 1" in repo.draft(p.id, "s14")["sec1"]  # ⑭のデプロイ記録に残る
    assert v["releases"][0]["number"] == 1


def test_release_github_and_manual(env, monkeypatch):
    from pf_agent import code, cycles

    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    c, p = env
    P = f"/products/{p.id}"
    finish_all(p)
    cycles.check_all()
    wait_idle(c, p.id)
    c.post(P + "/review/complete", headers=H, json={"next": "release"})
    wait_idle(c, p.id)
    # GitHub Actions：トークンが要る。あれば workflow_dispatch を起動する
    gh = {"kind": "github_actions", "repo": "acme/app", "workflow": "release.yml", "pass_plan": True}
    c.put(P + "/release/target", headers=H, json=gh)
    calls = []
    monkeypatch.setattr(code, "call", lambda m, path, tok, body=None: calls.append((m, path, body)))
    c.post(P + "/release/approve", headers=H)
    wait_idle(c, p.id)
    v = c.get(P + "/release", headers=H).json()
    assert v["state"] == "prerelease" and "トークン" in v["current"]["release"]["error"]  # 失敗したら戻る
    c.put("/settings/github", headers=H, json={"token": "tok"})
    c.post(P + "/release/approve", headers=H)
    wait_idle(c, p.id)
    v = c.get(P + "/release", headers=H).json()
    assert v["state"] == "done" and calls[0][1] == "/repos/acme/app/actions/workflows/release.yml/dispatches"
    assert calls[0][2]["ref"] == "main" and calls[0][2]["inputs"]["pf_cycle"] == "1"
    # 手動：PdM が完了にする
    body = {"strategy": "次へ"}
    c.post(P + "/review/next", headers=H, json=body)
    wait_idle(c, p.id)
    finish_all(p)
    cycles.check_all()
    wait_idle(c, p.id)
    c.post(P + "/review/complete", headers=H, json={"next": "release"})
    wait_idle(c, p.id)
    c.put(P + "/release/target", headers=H, json={"kind": "manual"})
    c.post(P + "/release/approve", headers=H)
    wait_idle(c, p.id)
    v = c.get(P + "/release", headers=H).json()
    assert v["state"] == "releasing" and v["current"]["release"]["status"] == "waiting_manual"
    v = c.post(P + "/release/manual", headers=H, json={"ok": True, "note": "本番に出した"}).json()
    assert v["state"] == "done" and [x["number"] for x in v["releases"]] == [2, 1]
