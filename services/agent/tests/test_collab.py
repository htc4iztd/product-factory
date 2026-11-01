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


def test_doc_readers(client):
    """手で書いたドキュメントも、読んでいいと決めたエージェントだけが読む（既定は全員）。"""
    from pf_agent import imports, tools
    from pf_agent.db import Product, session

    c = client
    pid = product(c)
    base = f"/products/{pid}"
    c.post(base + "/docs", headers=H, json={"title": "価格の方針", "body": "## 価格\n月額480円で始める"})
    d = c.get(base + "/docs/1", headers=H).json()
    assert d["readers_custom"] is False and "s05" in d["readers"] and "pm_biz" in d["readers"]
    assert "月額480円" in imports.docs_context(pid, "s05")
    assert "DOC-1「価格の方針」" in imports.docs_context(pid, "pm_biz")
    assert c.put(base + "/docs/1/readers", headers=VIEWER, json={"readers": ["s05"]}).status_code == 403
    assert c.put(base + "/docs/1/readers", headers=H, json={"readers": ["nobody"]}).status_code == 422
    d = c.put(base + "/docs/1/readers", headers=H, json={"readers": ["s05"]}).json()
    assert d["readers"] == ["s05"] and d["readers_custom"] is True
    assert imports.docs_context(pid, "s04") == "" and "月額480円" in imports.docs_context(pid, "s05")
    with session() as s:
        p = s.get(Product, pid)
        s.expunge(p)
    hit = tools.call(tools.Ctx(product=p, key="s05", tenant="tenant-a"), "docs_search", {"query": "480円"})
    assert "DOC-1" in hit
    miss = tools.call(tools.Ctx(product=p, key="s04", tenant="tenant-a"), "docs_search", {"query": "480円"})
    assert "DOC-1" not in miss


def test_removed_features(client):
    c = client
    pid = product(c)
    base = f"/products/{pid}"
    for path in ("/tickets", "/channels", "/decisions", "/meetings"):
        assert c.get(base + path, headers=H).status_code == 404, path
    assert c.post(base + "/tickets", headers=H, json={"title": "x"}).status_code in (404, 405)
    assert c.get(base + "/refs/DOC-9", headers=H).status_code == 404
    c.post(base + "/docs", headers=H, json={"title": "メモ"})
    assert c.get(base + "/refs/DOC-1", headers=H).json()["title"] == "メモ"
