"""自律エージェント：cron の読み方、予定の作成、時刻が来たら1回だけ動く、受け箱の提案を採用・却下・返信する。"""

import datetime as dt
import importlib
import time

import pytest
from fastapi.testclient import TestClient

from pf_agent import cron

H = {"x-pf-internal-token": "t", "x-pf-user": "owner@example.com", "x-pf-tenant": "tenant-a", "x-pf-role": "OWNER"}
VIEWER = {**H, "x-pf-role": "VIEWER"}
JST = cron.ZoneInfo("Asia/Tokyo")


def test_cron_next_and_errors():
    mon21 = dt.datetime(2026, 10, 26, 12, 0, tzinfo=dt.UTC)  # 月曜 21:00 JST
    nxt = lambda e: cron.next_after(e, mon21).astimezone(JST).strftime("%m-%d %H:%M %a")  # noqa: E731
    assert nxt("0 9 * * *") == "10-27 09:00 Tue"
    assert nxt("*/15 * * * *") == "10-26 21:15 Mon"
    assert nxt("0 9 * * 0") == "11-01 09:00 Sun" and nxt("0 9 * * 7") == "11-01 09:00 Sun"
    assert nxt("30 8 1 * *") == "11-01 08:30 Sun"
    # 日と曜日の両方：どちらかに合えば動く
    assert nxt("0 9 1 * 2") == "10-27 09:00 Tue"
    assert cron.describe("0 9 * * 1-5") == "平日 9:00" and cron.describe("5 * * * *") == "毎時 5分"
    for bad in ("0 9 * *", "61 * * * *", "a * * * *", "*/0 * * * *"):
        with pytest.raises(cron.CronError):
            cron.next_after(bad, mon21)


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/a.db")
    monkeypatch.setenv("PF_INTERNAL_TOKEN", "t")
    monkeypatch.setenv("PF_LLM", "stub")
    monkeypatch.delenv("K_SERVICE", raising=False)
    from pf_agent import api, db
    importlib.reload(db)
    importlib.reload(api)
    with TestClient(api.app) as c:
        yield c


def wait_job(c, jid):
    for _ in range(100):
        j = c.get(f"/jobs/{jid}", headers=H).json()
        if j["status"] in ("done", "failed"):
            return j
        time.sleep(0.1)
    raise AssertionError(j)


def test_schedule_tick_and_inbox(client):
    from pf_agent import agents
    from pf_agent.db import AgentSchedule, session
    c = client
    pid = c.post("/products", headers=H, json={"name": "見直し", "idea": "申込の受付"}).json()["id"]
    body = {"name": "毎朝の見直し", "task": "review", "stages": ["s09"], "cron": "0 9 * * 1-5"}
    assert c.post(f"/products/{pid}/agents", headers=VIEWER, json=body).status_code == 403
    assert c.post(f"/products/{pid}/agents", headers=H, json={**body, "cron": "0 9 * *"}).status_code == 422
    assert c.post(f"/products/{pid}/agents", headers=H, json={**body, "task": "custom"}).status_code == 422
    a = c.post(f"/products/{pid}/agents", headers=H, json=body).json()
    assert a["key"] == "AG-1" and a["cron_label"] == "平日 9:00" and a["next_run_at"]
    # 時刻が来る前は動かない。時刻を過ぎたら1回だけ動く（2回呼んでも二重にならない）
    assert c.post("/internal/scheduler/tick", headers={"x-pf-internal-token": "x"}).status_code == 401
    assert c.post("/internal/scheduler/tick", headers=H).json() == {"started": []}
    with session() as s:
        s.query(AgentSchedule).update({"next_run_at": dt.datetime.now(dt.UTC) - dt.timedelta(minutes=1)})
        s.commit()
    started = c.post("/internal/scheduler/tick", headers=H).json()["started"]
    assert len(started) == 1 and agents.tick() == []
    job = wait_job(c, started[0])
    assert job["status"] == "done" and [t["id"] for t in job["tasks"]] == ["read", "think", "post"]
    ov = c.get(f"/products/{pid}/agents", headers=H).json()
    assert ov["open"] >= 1 and ov["schedules"][0]["runs"] == 1
    assert dt.datetime.fromisoformat(ov["schedules"][0]["next_run_at"]) > dt.datetime.now(dt.UTC)
    # 受け箱：⑨の必須が空 → 案つきの提案。返信すると AI が答え、採用すると項目に入る
    fs = c.get(f"/products/{pid}/agent-findings?status=open", headers=H).json()
    f = next(x for x in fs if x["proposals"])
    assert f["agent"] == "AG-1" and f["stage"] == "s09" and f["severity"] == "action"
    r = c.post(f"/products/{pid}/agent-findings/{f['id']}/reply", headers=H, json={"text": "根拠は？"}).json()
    assert [m["role"] for m in r["thread"]] == ["user", "agent"] and "根拠は？" in r["thread"][1]["text"]
    r = c.post(f"/products/{pid}/agent-findings/{f['id']}/decide", headers=H, json={"action": "accept"}).json()
    assert r["status"] == "accepted"
    st = c.get(f"/products/{pid}/stages/s09", headers=H).json()
    assert st["draft"][f["proposals"][0]["field"]]
    assert c.post(f"/products/{pid}/agent-findings/{f['id']}/decide", headers=H,
                  json={"action": "reject"}).status_code == 409
    # 通知が予定を作った人に届く（作った本人が動かしたのではないので）
    assert any(n["kind"] == "agent" for n in c.get("/notices", headers=H).json()["items"])
    # 今すぐ動かす・止める・消す
    j = c.post(f"/products/{pid}/agents/1/run", headers=H).json()
    assert j["runs"] == 2 and wait_job(c, j["last_job_id"])["status"] == "done"
    a = c.put(f"/products/{pid}/agents/1", headers=H, json={"enabled": False, "cron": "30 8 * * *"}).json()
    assert a["enabled"] is False and a["cron_label"] == "毎日 8:30"
    assert c.delete(f"/products/{pid}/agents/1", headers=H).json() == {"ok": True}


def test_report_agent_regenerates(client):
    c = client
    pid = c.post("/products", headers=H, json={"name": "報告", "idea": "x"}).json()["id"]
    c.post(f"/products/{pid}/reports", headers=H, json={"title": "週報", "selection": [{"stage": "s01"}]})
    assert c.post(f"/products/{pid}/agents", headers=H,
                  json={"task": "report", "cron": "0 18 * * 5", "params": {}}).status_code == 422
    a = c.post(f"/products/{pid}/agents", headers=H,
               json={"task": "report", "cron": "0 18 * * 5", "params": {"report": 1}}).json()
    assert a["name"] == "報告資料の作り直し"
    j = c.post(f"/products/{pid}/agents/{a['number']}/run", headers=H).json()
    job = wait_job(c, j["last_job_id"])
    assert job["kind"] == "report" and job["status"] == "done"
