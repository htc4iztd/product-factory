"""エージェントの組織（司令塔・PM・各工程の担当）と掲示板：PdM と司令塔の対話で決めたことが PM → 担当に伝わり、
やり取りが掲示板に残り、PdM が追加の指示を出せる。"""

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
    for _ in range(150):
        j = c.get(f"/jobs/{jid}", headers=H).json()
        if j["status"] in ("done", "failed"):
            return j
        time.sleep(0.1)
    raise AssertionError(j)


def test_team_cycle_board_and_director(client):
    c = client
    pid = c.post("/products", headers=H, json={"name": "組織", "idea": "申込の受付"}).json()["id"]
    t = c.get(f"/products/{pid}/team", headers=H).json()
    keys = [a["key"] for a in t["agents"]]
    assert keys[:3] == ["director", "pm", "s01"] and len(keys) == 16
    assert t["agents"][0]["name"] == "司令塔" and t["agents"][2]["name"] == "①アイディエーション担当"
    # ①を進めている状態にして、全員を動かす：進めていない工程の担当は動かない
    c.put(f"/products/{pid}/stages/s01/draft", headers=H, json={"field": "problem", "value": ["締めが面倒"]})
    assert c.post(f"/products/{pid}/team/run", headers=VIEWER, json={}).status_code == 403
    job = wait_job(c, c.post(f"/products/{pid}/team/run", headers=H, json={}).json()["job_id"])
    assert job["status"] == "done", job
    st = {x["id"]: x["status"] for x in job["tasks"]}
    assert st["director"] == st["pm"] == st["s01"] == "done" and st["s02"] == "skipped"
    t = c.get(f"/products/{pid}/team", headers=H).json()
    s01 = next(a for a in t["agents"] if a["key"] == "s01")
    assert s01["report"]["health"] == "yellow" and s01["open_tasks"] >= 1 and 0 < s01["report"]["progress"] < 100
    # 担当の質問と直し案は ①の対話（担当エージェントから）にも出る
    stage = c.get(f"/products/{pid}/stages/s01", headers=H).json()
    sess = next(x for x in stage["sessions"] if x["title"] == "担当エージェントから")
    chat = c.get(f"/products/{pid}/stages/s01?session_id={sess['id']}", headers=H).json()["chat"]
    assert chat[-1]["proposals"] and "方針を教えてください" in chat[-1]["text"]
    # 司令塔の今日の議題 → PdM はいつでも話しかけられる。決めたら「決定」が残り、PM に指示が飛ぶ
    d = c.get(f"/products/{pid}/director", headers=H).json()
    assert d["thread"] and d["posts"][0]["sender"] == "director" and d["posts"][0]["intent"] == "question"
    r = c.post(
        f"/products/{pid}/director/talk", headers=H, json={"text": "最初は共働き世帯で検証する。これで決定"}
    ).json()
    assert r["decided"] and r["thread"] == d["thread"] and r["job_id"]
    wait_job(c, r["job_id"])
    d = c.get(f"/products/{pid}/director", headers=H).json()
    assert d["strategy"]["strategy"].startswith("最初は共働き世帯")
    intents = [(p["sender"], p["recipient"], p["intent"]) for p in d["posts"]]
    assert ("pdm", "director", "directive") in intents and ("director", "all", "decision") in intents
    assert ("director", "pm", "directive") in intents and ("pm", "director", "answer") in intents
    # 掲示板：誰が何を言ったかを、エージェントで絞って追える
    b = c.get(f"/products/{pid}/board?agent=pm", headers=H).json()
    assert any(p["sender"] == "pm" for th in b["threads"] for p in th["posts"])
    assert c.get(f"/products/{pid}/board?q=共働き", headers=H).json()["threads"]
    # PdM が掲示板から追加の指示：宛先の担当がすぐ動き、答える
    r = c.post(f"/products/{pid}/board", headers=H, json={"to": "s01", "text": "課題をもう1つ足して"}).json()
    wait_job(c, r["job_id"])
    th = c.get(f"/products/{pid}/board?thread={r['thread']}", headers=H).json()["threads"][0]
    assert [(p["sender"], p["intent"]) for p in th["posts"]] == [("pdm", "directive"), ("s01", "answer")]
    assert th["posts"][0]["read"] is True
    # ダッシュボード：エージェント同士のやり取り（線）と PdM 宛て
    dash = c.get(f"/products/{pid}/dashboard", headers=H).json()
    assert dash["stages"][0]["id"] == "s01" and len(dash["agents"]) == 16
    assert any(e["source"] == "director" and e["target"] == "pm" for e in dash["edges"])
    assert any(p["sender"] == "s01" for p in dash["to_pdm"])
    # タスクは PdM も足し・直せる
    task = c.post(
        f"/products/{pid}/team/tasks", headers=H, json={"agent": "s01", "title": "顧客に聞く", "owner": "pdm"}
    ).json()
    assert (
        c.put(f"/products/{pid}/team/tasks/{task['number']}", headers=H, json={"status": "done"}).json()["status"]
        == "done"
    )


def test_team_schedule_and_settings(client):
    from pf_agent import team
    from pf_agent.db import TeamAgent, session

    c = client
    pid = c.post("/products", headers=H, json={"name": "予定", "idea": "x"}).json()["id"]
    c.get(f"/products/{pid}/team", headers=H)
    a = c.put(f"/products/{pid}/team/pm", headers=H, json={"cron": "0 18 * * 5", "mission": "週次で見る"}).json()
    assert a["cron_label"] == "毎週金曜 18:00" and a["mission"] == "週次で見る"
    assert c.put(f"/products/{pid}/team/pm", headers=H, json={"cron": "x"}).status_code == 422
    with session() as s:
        s.query(TeamAgent).filter(TeamAgent.key.in_(["director", "pm"])).update(
            {"next_run_at": dt.datetime.now(dt.UTC) - dt.timedelta(minutes=1)}
        )
        s.commit()
    started = c.post("/internal/scheduler/tick", headers=H).json()["started"]
    assert len(started) == 1 and team.tick() == []  # 同じプロダクトは1つのジョブにまとめ、二重に動かさない
    job = wait_job(c, started[0])
    assert [x["id"] for x in job["tasks"]][:2] == ["director", "pm"] and job["params"]["reason"] == "予定"
