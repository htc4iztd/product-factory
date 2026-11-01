"""エージェントとの対話への添付（その発言のときだけ AI が読む）と、取り込んだ資料を読んでいいエージェントの割り当て。"""

import base64
import importlib
import time

import pytest
from fastapi.testclient import TestClient

H = {"x-pf-internal-token": "t", "x-pf-user": "owner@example.com", "x-pf-tenant": "tenant-a", "x-pf-role": "OWNER"}
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/a.db")
    monkeypatch.setenv("PF_INTERNAL_TOKEN", "t")
    monkeypatch.setenv("PF_LLM", "stub")
    from pf_agent import api, db
    importlib.reload(db)
    importlib.reload(api)
    with TestClient(api.app) as c:
        yield c


def b64(x: bytes) -> str:
    return base64.b64encode(x).decode()


def stage_say(c, pid, sid, message, session_id=None, attachments=()):
    """工程の対話（AI の案）を内部の関数で動かす。API は閉じた（PdM は担当と直接話さない）。"""
    import asyncio

    from pf_agent import api
    from pf_agent.db import Product, session

    with session() as s:
        p = s.get(Product, pid)
        s.expunge(p)
    sess = asyncio.run(api.engine.chat(p, sid, "owner@example.com", message, session_id, list(attachments)))
    return c.get(f"/products/{pid}/stages/{sid}?session={sess}", headers=H).json()


def test_chat_attachments_reach_the_ai_once(client, monkeypatch):
    from pf_agent import llm
    seen = []
    real = llm.converse

    def spy(conn, stage, fw, idea, draft, upstream, history, message, images=None):
        seen.append((message, images or [], history))
        return real(conn, stage, fw, idea, draft, upstream, history, message, images)

    monkeypatch.setattr(llm, "converse", spy)
    c = client
    pid = c.post("/products", headers=H, json={"name": "添付", "idea": "x"}).json()["id"]
    doc = c.post(f"/products/{pid}/agents/s01/attachments", headers=H,
                 json={"filename": "メモ.md", "content_b64": b64("# 顧客\n共働きの夫婦".encode())}).json()
    img = c.post(f"/products/{pid}/agents/s01/attachments", headers=H,
                 json={"filename": "画面.png", "content_b64": b64(PNG)}).json()
    assert doc["kind"] == "doc" and img["kind"] == "image"
    assert c.post(f"/products/{pid}/agents/s01/attachments", headers=H,
                  json={"filename": "a.pdf", "content_b64": b64(b"%PDF")}).status_code == 422
    assert c.post(f"/products/{pid}/agents/x/attachments", headers=H,
                  json={"filename": "a.md", "content_b64": b64(b"x")}).status_code == 422
    # 別の担当の対話には使えない
    from pf_agent.engine import FactoryError

    with pytest.raises(FactoryError):
        stage_say(c, pid, "s02", "読んで", attachments=[doc["id"]])
    assert c.post(f"/products/{pid}/stages/s01/chat", headers=H, json={"message": "x"}).status_code == 410
    st = stage_say(c, pid, "s01", "この資料を読んで", attachments=[doc["id"], img["id"]])
    user = [m for m in st["chat"] if m["role"] == "user"][-1]
    assert [a["filename"] for a in user["attachments"]] == ["メモ.md", "画面.png"]
    msg, images, _ = seen[-1]
    assert "共働きの夫婦" in msg and "画面.png" in msg and images[0][1] == "image/png"
    # 次の発言では、添付の中身は渡さず、名前だけが履歴に残る
    stage_say(c, pid, "s01", "続けて")
    msg, images, history = seen[-1]
    assert "共働きの夫婦" not in msg and images == [] and any("［添付：メモ.md］" in h["text"] for h in history)
    # PM との対話にも添えられる
    d = c.post(f"/products/{pid}/agents/pm_biz/attachments", headers=H,
               json={"filename": "方針.txt", "content_b64": b64("MVP は締めだけ".encode())}).json()
    r = c.post(f"/products/{pid}/pm/pm_biz/talk", headers=H, json={"text": "読んで", "attachments": [d["id"]]}).json()
    assert r["message"]["attachments"][0]["filename"] == "方針.txt"


def test_import_readers(client):
    from test_imports import xlsx

    from pf_agent import imports
    c = client
    pid = c.post("/products", headers=H, json={"name": "取込", "idea": "x"}).json()["id"]
    d = c.post(f"/products/{pid}/imports", headers=H,
               json={"filename": "仕様.xlsx", "content_b64": b64(xlsx())}).json()
    for _ in range(100):
        d = c.get(f"/products/{pid}/imports/{d['id']}", headers=H).json()
        if d["status"] == "done":
            break
        time.sleep(0.1)
    # 決めていなければ、割り当てた工程（「設計方針」がある⑨⑩）の担当と、その領域の PM
    assert d["readers"] == ["pm_design", "s09", "s10"] and d["readers_custom"] is False
    assert imports.docs_context(pid, "s01") == ""
    d = c.put(f"/products/{pid}/imports/{d['id']}/readers", headers=H, json={"readers": ["s01", "pm_biz"]}).json()
    assert d["readers"] == ["pm_biz", "s01"] and d["readers_custom"] is True
    assert "受付はAPIで行う" in imports.docs_context(pid, "s01")
    assert imports.docs_context(pid, "s09") == "" and imports.docs_context(pid, "pm_design") == ""
    assert c.put(f"/products/{pid}/imports/{d['id']}/readers", headers=H, json={"readers": ["zz"]}).status_code == 422
