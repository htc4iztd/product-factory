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
    assert c.post(f"/products/{pid}/stages/s02/chat", headers=H,
                  json={"message": "読んで", "attachments": [doc["id"]]}).status_code == 404
    st = c.post(f"/products/{pid}/stages/s01/chat", headers=H,
                json={"message": "この資料を読んで", "attachments": [doc["id"], img["id"]]}).json()
    user = [m for m in st["chat"] if m["role"] == "user"][-1]
    assert [a["filename"] for a in user["attachments"]] == ["メモ.md", "画面.png"]
    msg, images, _ = seen[-1]
    assert "共働きの夫婦" in msg and "画面.png" in msg and images[0][1] == "image/png"
    # 次の発言では、添付の中身は渡さず、名前だけが履歴に残る
    c.post(f"/products/{pid}/stages/s01/chat", headers=H, json={"message": "続けて"})
    msg, images, history = seen[-1]
    assert "共働きの夫婦" not in msg and images == [] and any("［添付：メモ.md］" in h["text"] for h in history)
    # 司令塔との対話にも添えられる
    d = c.post(f"/products/{pid}/agents/director/attachments", headers=H,
               json={"filename": "方針.txt", "content_b64": b64("MVP は締めだけ".encode())}).json()
    r = c.post(f"/products/{pid}/director/talk", headers=H, json={"text": "読んで", "attachments": [d["id"]]}).json()
    th = c.get(f"/products/{pid}/board?thread={r['thread']}", headers=H).json()["threads"][0]
    assert any("［添付：方針.txt］" in p["text"] for p in th["posts"] if p["sender"] == "pdm")


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
    # 決めていなければ、割り当てた工程（「設計方針」がある⑨⑩）の担当と司令塔・PM
    assert d["readers"] == ["director", "pm", "s09", "s10"] and d["readers_custom"] is False
    assert imports.docs_context(pid, "s01") == ""
    d = c.put(f"/products/{pid}/imports/{d['id']}/readers", headers=H, json={"readers": ["s01", "pm"]}).json()
    assert d["readers"] == ["pm", "s01"] and d["readers_custom"] is True
    assert "受付はAPIで行う" in imports.docs_context(pid, "s01")
    assert imports.docs_context(pid, "s09") == "" and imports.docs_context(pid, "director") == ""
    assert c.put(f"/products/{pid}/imports/{d['id']}/readers", headers=H, json={"readers": ["zz"]}).status_code == 422
