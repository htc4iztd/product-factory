"""ドキュメント（DOC-n）。チケット・議論・決定記録・会議は廃止した（API は 404 を返す）。"""
import importlib

import pytest
from fastapi.testclient import TestClient

H = {"x-pf-internal-token": "t", "x-pf-user": "owner@example.com", "x-pf-tenant": "tenant-a", "x-pf-role": "OWNER"}
BOB = {**H, "x-pf-user": "bob@example.com", "x-pf-role": "MEMBER"}
VIEWER = {**H, "x-pf-user": "v@example.com", "x-pf-role": "VIEWER"}
OTHER = {**H, "x-pf-tenant": "tenant-b"}


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


def product(c):
    return c.post("/products", headers=H, json={"name": "家計簿", "idea": "共働き世帯の家計簿"}).json()["id"]


def test_docs(client):
    c = client
    pid = product(c)
    base = f"/products/{pid}"
    d = c.post(base + "/docs", headers=H, json={"title": "競合メモ", "body": "US-01 と DEC-1 に関係"}).json()
    assert d["key"] == "DOC-1" and d["refs"] == ["US-01", "DEC-1"]
    d = c.put(base + "/docs/1", headers=BOB, json={"body": "書き直し"}).json()
    assert d["body"] == "書き直し" and d["updated_by"] == "bob@example.com" and d["refs"] == []
    assert c.get(base + "/docs", headers=H).json()[0]["title"] == "競合メモ"


def test_removed_features(client):
    c = client
    pid = product(c)
    base = f"/products/{pid}"
    for path in ("/tickets", "/channels", "/decisions", "/meetings", "/github"):
        assert c.get(base + path, headers=H).status_code == 404, path
    assert c.post(base + "/tickets", headers=H, json={"title": "x"}).status_code in (404, 405)
    assert c.get(base + "/refs/DOC-9", headers=H).status_code == 404
    c.post(base + "/docs", headers=H, json={"title": "メモ"})
    assert c.get(base + "/refs/DOC-1", headers=H).json()["title"] == "メモ"
