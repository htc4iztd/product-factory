"""ダッシュボードで承認する案：工程に届いた案と、定期の仕事の案を1か所に集め、承認したものだけ下書きに入れる。"""

import asyncio
import importlib

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


def test_dashboard_approvals(client):
    from pf_agent import api
    from pf_agent.db import AgentFinding, Product, session

    c = client
    pid = c.post("/products", headers=H, json={"name": "承認", "idea": "家計簿"}).json()["id"]
    with session() as s:
        p = s.get(Product, pid)
        s.expunge(p)
    # 工程に届いた案（内部で AI の案を作る）と、定期の仕事の案
    asyncio.run(api.engine.chat(p, "s01", "u", "下書きを作って", None, []))
    with session() as s:
        s.add(
            AgentFinding(
                tenant_id="tenant-a",
                product_id=pid,
                schedule_id=None,
                stage_id="s09",
                severity="warn",
                title="設計方針が空",
                body="方針を決める",
                status="open",
                proposals=[{"field": "overview", "label": "設計方針", "value": "モノリスで作る"}],
                thread=[],
            )
        )
        s.commit()
    items = c.get(f"/products/{pid}/approvals", headers=H).json()
    st = [x for x in items if x["kind"] == "stage"]
    fd = next(x for x in items if x["kind"] == "finding")
    assert st and all(x["stage_id"] == "s01" and x["before"] == "（空）" for x in st)
    assert (
        fd["stage_label"] == "⑨アプリケーション設計"
        and "モノリスで作る" in fd["after"]
        and fd["source"] == "定期の仕事"
    )
    # 閲覧のみの人は答えられない
    assert (
        c.post(f"/products/{pid}/approvals", headers=VIEWER, json={"keys": [st[0]["key"]], "accept": True}).status_code
        == 403
    )
    # 承認 → 下書きに入る。否認 → 入らない。二度は答えられない
    r = c.post(f"/products/{pid}/approvals", headers=H, json={"keys": [st[0]["key"], fd["key"]], "accept": True}).json()
    assert len(r["done"]) == 2 and st[0]["key"] not in [x["key"] for x in r["pending"]]
    assert c.get(f"/products/{pid}/stages/s09", headers=H).json()["draft"]["overview"] == "モノリスで作る"
    s01 = c.get(f"/products/{pid}/stages/s01", headers=H).json()["draft"]
    assert s01[st[0]["field"]] not in ("", [])
    r = c.post(f"/products/{pid}/approvals", headers=H, json={"keys": [st[1]["key"]], "accept": False}).json()
    assert r["done"] == [st[1]["key"]]
    assert c.get(f"/products/{pid}/stages/s01", headers=H).json()["draft"][st[1]["field"]] in ("", [])
    assert (
        c.post(f"/products/{pid}/approvals", headers=H, json={"keys": [st[0]["key"]], "accept": True}).status_code
        == 409
    )
