"""エージェントの組織：PdM は PM とだけ話し、PM が Issue で担当に伝え、担当は Issue を実行して工程に書き込み、
結果を返す。PM の状況確認・振り返りの会議・定期実行（必ず動く・二重に動かない・失敗したらやり直す）。"""

import datetime as dt
import importlib
import time

import pytest
from fastapi.testclient import TestClient

H = {"x-pf-internal-token": "t", "x-pf-user": "owner@example.com", "x-pf-tenant": "tenant-a", "x-pf-role": "OWNER"}
VIEWER = {**H, "x-pf-role": "VIEWER"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/t.db")
    monkeypatch.setenv("PF_INTERNAL_TOKEN", "t")
    monkeypatch.setenv("PF_LLM", "stub")
    monkeypatch.delenv("K_SERVICE", raising=False)
    from pf_agent import api, db
    importlib.reload(db)
    importlib.reload(api)
    with TestClient(api.app) as c:
        yield c


def wait_job(c, jid):
    for _ in range(200):
        j = c.get(f"/jobs/{jid}", headers=H).json()
        if j["status"] in ("done", "failed"):
            return j
        time.sleep(0.1)
    raise AssertionError(j)


def wait_idle(c, pid):
    for _ in range(200):
        js = c.get(f"/jobs?product={pid}", headers=H).json()
        rows = js if isinstance(js, list) else js.get("runs", js.get("items", []))
        if not any(r["status"] in ("queued", "running") for r in rows):
            return
        time.sleep(0.1)
    raise AssertionError("jobs still running")


def new_product(c, name="組織"):
    return c.post("/products", headers=H, json={"name": name, "idea": "申込の受付"}).json()["id"]


def test_pdm_talks_to_pm_and_issue_flows(client):
    c = client
    pid = new_product(c)
    t = c.get(f"/products/{pid}/team", headers=H).json()
    keys = [a["key"] for a in t["agents"]]
    assert keys[:4] == ["pm_biz", "pm_design", "pm_impl", "s01"] and len(keys) == 17
    assert t["agents"][0]["name"] == "事業PM" and t["agents"][0]["domain"] == ["s01", "s02", "s03", "s04", "s05"]
    assert t["meeting"]["cron_label"] == "平日 18:00"
    # PdM は PM とだけ話せる
    assert c.post(f"/products/{pid}/pm/s01/talk", headers=H, json={"text": "x"}).status_code == 404
    assert c.post(f"/products/{pid}/pm/pm_biz/talk", headers=VIEWER, json={"text": "x"}).status_code == 403
    # ①の画面から事業 PM に頼む → 事業 PM が①の担当に Issue を起票 → 担当がすぐ動き、工程に書き込み、PM に返す
    body = {"text": "①の下書きを作って", "stage_id": "s01"}
    r = c.post(f"/products/{pid}/pm/pm_biz/talk", headers=H, json=body).json()
    assert r["issues"] == [1] and "#1" in r["reply"]["text"]
    wait_idle(c, pid)
    i = c.get(f"/products/{pid}/issues/1", headers=H).json()
    assert i["author"] == "pm_biz" and i["stage_id"] == "s01"
    # 担当が解決して起票した PM に返し、PM が確かめて終了にする（記録が残る）
    who = [(j["author"], [d["prop"] for d in j["details"]]) for j in i["journals"]]
    assert who[0][0] == "s01" and "status" in who[0][1] and "assignee" in who[0][1]
    assert i["status"] == "closed" and i["assignee"] == "pm_biz" and who[-1][0] == "pm_biz"
    st = c.get(f"/products/{pid}/stages/s01", headers=H).json()
    assert st["missing"] == []                  # 担当が工程の下書きに書き込んだ
    # 掲示板はエージェント同士だけ（PdM は書けない）
    assert c.post(f"/products/{pid}/board", headers=H, json={"to": "s01", "text": "x"}).status_code == 405
    b = c.get(f"/products/{pid}/board", headers=H).json()
    assert b["threads"]
    assert all(p["sender"] != "pdm" and p["recipient"] != "pdm" for t in b["threads"] for p in t["posts"])
    # PM の作業場所：対話・状況確認で集めたこと
    w = c.get(f"/products/{pid}/pm/pm_biz", headers=H).json()
    assert [m["role"] for m in w["messages"]][:2] == ["pdm", "pm"] and w["checked_at"]
    assert any(n["agent"] == "s01" and n["kind"] == "status" for n in w["notes"])


def test_issue_rules(client):
    c = client
    pid = new_product(c)
    c.get(f"/products/{pid}/team", headers=H)
    # PdM が起票できるのは PM 宛てだけ。PdM は宛先にできない
    assert c.post(f"/products/{pid}/issues", headers=H, json={"assignee": "s01", "subject": "x"}).status_code == 403
    assert c.post(f"/products/{pid}/issues", headers=H, json={"assignee": "pdm", "subject": "x"}).status_code == 422
    i = c.post(f"/products/{pid}/issues", headers=H,
               json={"assignee": "pm_design", "subject": "⑨を見直して", "tracker": "feature",
                     "priority": "high"}).json()
    assert i["key"] == "#1" and i["tracker_label"] == "機能" and i["priority_label"] == "高め" and i["status"] == "new"
    wait_idle(c, pid)
    # PM が受けて担当に振る（スタブは進行中にする）。PdM は PM が担当の Issue にだけ書き込める
    from pf_agent import issues
    from pf_agent.db import Product, session
    with session() as s:
        p = s.get(Product, pid)
        s.expunge(p)
    issues.update(p, "pm_design", 1, notes="⑨担当に振ります", assignee="s09", wake=False)
    assert c.put(f"/products/{pid}/issues/1", headers=H, json={"notes": "急いで"}).status_code == 403
    with pytest.raises(issues.IssueError):
        issues.update(p, "s09", 1, assignee="pdm")
    lst = c.get(f"/products/{pid}/issues?assignee=s09&open_only=true", headers=H).json()
    assert [x["number"] for x in lst] == [1]
    wait_idle(c, pid)


def test_meeting_reports_and_reviews(client):
    c = client
    pid = new_product(c)
    c.post(f"/products/{pid}/pm/pm_biz/talk", headers=H, json={"text": "①の下書きを作って", "stage_id": "s01"})
    wait_idle(c, pid)
    m = c.post(f"/products/{pid}/meetings-daily", headers=H).json()
    j = wait_job(c, m["job_id"])
    assert j["status"] == "done", j
    assert [t["id"] for t in j["tasks"]] == ["report:pm_biz", "report:pm_design", "report:pm_impl",
                                             "review:pm_biz", "review:pm_design", "review:pm_impl"]
    m = c.get(f"/products/{pid}/meetings-daily/{m['id']}", headers=H).json()
    assert m["status"] == "open" and set(m["reports"]) == {"pm_biz", "pm_design", "pm_impl"}
    assert len(m["reviews"]) == 6 and all(r["pm"] != r["about"] for r in m["reviews"])
    # 集めたことは会議で伝えた扱いになる
    w = c.get(f"/products/{pid}/pm/pm_biz", headers=H).json()
    assert w["pending"] == 0 and all(n["meeting_id"] == m["id"] for n in w["notes"])
    # 会議の中で PM と話す
    c.post(f"/products/{pid}/pm/pm_design/talk", headers=H, json={"text": "設計は来週までに", "meeting_id": m["id"]})
    m = c.get(f"/products/{pid}/meetings-daily/{m['id']}", headers=H).json()
    assert [x["role"] for x in m["messages"]] == ["pdm", "pm"]
    assert c.post(f"/products/{pid}/meetings-daily/{m['id']}/close", headers=H).json()["status"] == "closed"
    wait_idle(c, pid)


def test_schedule_always_runs(client):
    from pf_agent import team
    from pf_agent.db import JobRun, TeamAgent, session
    c = client
    pid = new_product(c)
    c.get(f"/products/{pid}/team", headers=H)
    past = dt.datetime.now(dt.UTC) - dt.timedelta(minutes=1)

    def due(*keys):
        with session() as s:
            s.query(TeamAgent).filter(TeamAgent.product_id == pid, TeamAgent.key.in_(keys)).update(
                {"next_run_at": past}, synchronize_session=False)
            s.commit()

    # 工程の担当は Issue がなければ AI を呼ばない（ジョブを作らない）が、確かめた時刻は残る。PM は動く
    due("pm_design", "s07")
    started = c.post("/internal/scheduler/tick", headers=H).json()["started"]
    assert len(started) == 1 and team.tick() == []           # 二重には動かさない
    job = wait_job(c, started[0])
    assert [x["id"] for x in job["tasks"]] == ["pm_design"]
    t = c.get(f"/products/{pid}/team", headers=H).json()
    assert t["beats"]["tick"]["at"]
    with session() as s:
        assert s.query(TeamAgent).filter_by(product_id=pid, key="s07").one().memory["checked_at"]
    # 起動に失敗したら、時刻を戻して次の呼び出しでやり直す
    due("pm_impl")
    real = team.start
    team.start = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("down"))
    try:
        assert team.tick() == []
    finally:
        team.start = real
    with session() as s:
        at = s.query(TeamAgent).filter_by(product_id=pid, key="pm_impl").one().next_run_at
        assert (at if at.tzinfo else at.replace(tzinfo=dt.UTC)) <= dt.datetime.now(dt.UTC)
    again = team.tick()
    assert len(again) == 1
    wait_job(c, again[0])
    # 時間を過ぎても終わらないジョブは失敗にする
    with session() as s:
        s.add(JobRun(kind="team", tenant_id="tenant-a", product_id=pid, params={}, status="running", created_by="x",
                     created_at=dt.datetime.now(dt.UTC) - dt.timedelta(hours=5),
                     started_at=dt.datetime.now(dt.UTC) - dt.timedelta(hours=5)))
        s.commit()
    assert team.reap() >= 1
    # 画面を開いていないプロダクトにもエージェントを置く
    other = new_product(c, "未表示")
    team.ensure_all()
    with session() as s:
        assert s.query(TeamAgent).filter_by(product_id=other).count() == 18


def test_avatars(client):
    c = client
    r = c.get("/avatars/pm_biz", headers=H)
    assert r.headers["content-type"].startswith("image/svg") and r.headers["x-avatar-version"] == "0"
    assert c.get("/avatars/director", headers=H).status_code == 404
    assert c.post("/avatars/generate", headers=VIEWER, json={}).status_code == 403
    job = c.post("/avatars/generate", headers=H, json={"keys": ["pm_biz", "s01"]}).json()
    assert wait_job(c, job["id"])["status"] == "done"
    assert set(c.get("/avatars", headers=H).json()) == {"pm_biz", "s01"}
