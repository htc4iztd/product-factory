"""R0 完了条件「仮の入力で P0〜P5 が通る」を API 経由で確かめる。"""
import importlib

import pytest
from fastapi.testclient import TestClient

H = {"x-pf-internal-token": "t", "x-pf-user": "owner@example.com",
     "x-pf-tenant": "tenant-a", "x-pf-role": "OWNER"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/f.db")
    monkeypatch.setenv("PF_INTERNAL_TOKEN", "t")
    monkeypatch.setenv("PF_LLM", "stub")
    from pf_agent import api, db
    importlib.reload(db)
    importlib.reload(api)
    with TestClient(api.app) as c:
        yield c


def run_stage(c, pid, sid, decision="Approve"):
    r = c.post(f"/products/{pid}/stages/{sid}/start", headers=H)
    assert r.status_code == 200, r.text
    assert r.json()["pending"]["kind"] == "clarify"
    r = c.post(f"/products/{pid}/stages/{sid}/respond", headers=H, json={"answer": "仮の回答"})
    assert r.json()["pending"]["kind"] == "approval", r.text
    assert r.json()["stage"]["audit_findings"] == []
    r = c.post(f"/products/{pid}/stages/{sid}/respond", headers=H, json={"decision": decision, "comment": ""})
    assert r.status_code == 200, r.text
    assert r.json()["pending"] is None
    assert r.json()["stage"]["status"] == "completed"


def test_full_cycle(client):
    c = client
    p = c.post("/products", headers=H, json={"name": "テスト", "idea": "小さな家計簿アプリ"}).json()
    pid = p["id"]
    ov = c.get(f"/products/{pid}", headers=H).json()
    phases = ov["phases"]
    for ph in phases:
        for sid in ph["stages"]:
            run_stage(c, pid, sid)
        if ph["gate"]:
            r = c.post(f"/products/{pid}/phases/{ph['id']}/review", headers=H, json={"decision": "proceed"})
            assert r.status_code == 200, r.text
    ov = c.get(f"/products/{pid}", headers=H).json()
    assert all(s["status"] == "completed" for s in ov["stages"])
    kinds = [a["kind"] for a in c.get(f"/products/{pid}/audit", headers=H).json()]
    assert kinds.count("approval") == 14 and "phase.review.G4" in kinds


def test_gate_blocks_next_phase(client):
    c = client
    pid = c.post("/products", headers=H, json={"name": "x", "idea": "y"}).json()["id"]
    for sid in ("s01", "s02", "s03"):
        run_stage(c, pid, sid)
    r = c.post(f"/products/{pid}/stages/s04/start", headers=H)
    assert r.status_code == 409  # G1 の審査前は P2 を始められない


def test_request_changes_and_recheck(client):
    c = client
    pid = c.post("/products", headers=H, json={"name": "x", "idea": "y", "scope": "poc"}).json()["id"]
    run_stage(c, pid, "s01")
    ov = c.get(f"/products/{pid}", headers=H).json()
    assert {s["id"]: s["status"] for s in ov["stages"]}["s02"] == "skipped"
    # Request Changes は理由が必須
    c.post(f"/products/{pid}/phases/P1/review", headers=H, json={"decision": "proceed"})
    c.post(f"/products/{pid}/stages/s04/start", headers=H)
    c.post(f"/products/{pid}/stages/s04/respond", headers=H, json={"answer": "a"})
    r = c.post(f"/products/{pid}/stages/s04/respond", headers=H, json={"decision": "Request Changes", "comment": ""})
    assert r.status_code == 422
    r = c.post(f"/products/{pid}/stages/s04/respond", headers=H,
               json={"decision": "Request Changes", "comment": "北極星指標を具体的に"})
    st = r.json()["stage"]
    assert r.json()["pending"]["kind"] == "approval" and st["current_version"] == 2
    assert "北極星指標を具体的に" in st["artifact"]["content"]
    c.post(f"/products/{pid}/stages/s04/respond", headers=H, json={"decision": "Approve"})
    run_stage(c, pid, "s05")
    # ④をやり直して承認すると、参照している⑤が「要再確認」になる
    run_stage(c, pid, "s04")
    ov = c.get(f"/products/{pid}", headers=H).json()
    assert {s["id"]: s["status"] for s in ov["stages"]}["s05"] == "needs_recheck"


def test_tenant_isolation(client):
    c = client
    pid = c.post("/products", headers=H, json={"name": "x", "idea": "y"}).json()["id"]
    other = dict(H, **{"x-pf-tenant": "tenant-b"})
    assert c.get(f"/products/{pid}", headers=other).status_code == 404
    bad = dict(H, **{"x-pf-internal-token": "wrong"})
    assert c.get("/products", headers=bad).status_code == 401
    viewer = dict(H, **{"x-pf-role": "VIEWER"})
    assert c.post("/products", headers=viewer, json={"name": "x"}).status_code == 403


def test_resume_after_restart(tmp_path, monkeypatch):
    """入力待ちのままプロセスが落ちても、別のエンジン（=再起動後）から再開できる。"""
    import asyncio
    monkeypatch.setenv("PF_LLM", "stub")
    url = f"sqlite:///{tmp_path}/r.db"
    from pf_agent.engine import Engine

    async def go():
        e1 = Engine(url)
        p = e1.create_product("t", "u", "x", "y")
        pend = await e1.start_stage(p, "s01", "u")
        assert pend["kind"] == "clarify"
        e2 = Engine(url)  # 再起動を模す：セッションサービスもランナーも作り直す
        pend = await e2.respond(e2.product(p.id), "s01", "u", {"answer": "a"})
        assert pend["kind"] == "approval"
        e3 = Engine(url)
        pend = await e3.respond(e3.product(p.id), "s01", "u", {"decision": "Approve"})
        assert pend is None
        assert e3.stage_detail(e3.product(p.id), "s01")["status"] == "completed"
    asyncio.run(go())
