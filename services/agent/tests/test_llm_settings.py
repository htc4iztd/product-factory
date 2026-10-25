"""LLM の接続設定：テナントの上書き・運用者の既定・キーの暗号化・URL の検査・OpenAI 互換での対話。"""
import importlib
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from fastapi.testclient import TestClient

H = {"x-pf-internal-token": "t", "x-pf-user": "owner@example.com", "x-pf-tenant": "tenant-a", "x-pf-role": "OWNER"}
ADMIN = {**H, "x-pf-user": "ops@example.com", "x-pf-tenant": "tenant-ops"}
MEMBER = {**H, "x-pf-user": "m@example.com", "x-pf-role": "MEMBER"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/f.db")
    monkeypatch.setenv("PF_INTERNAL_TOKEN", "t")
    monkeypatch.setenv("PF_LLM", "stub")
    monkeypatch.setenv("PF_ADMIN_EMAILS", "ops@example.com")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "my-proj")
    from pf_agent import api, db
    importlib.reload(db)
    importlib.reload(api)
    with TestClient(api.app) as c:
        yield c


def test_tenant_override_and_key_is_encrypted(client):
    c = client
    s = c.get("/settings/llm", headers=H).json()
    assert s["can_edit"] and not s["is_admin"] and s["app"] is None
    assert s["effective"]["provider"] == "stub" and s["effective"]["source"] == "env"
    # MEMBER は変えられない
    assert c.put("/settings/llm/tenant", headers=MEMBER, json={"provider": "stub"}).status_code == 403
    # キーが要る方式でキーが無ければ断る
    assert c.put("/settings/llm/tenant", headers=H, json={"provider": "anthropic"}).status_code == 422
    r = c.put("/settings/llm/tenant", headers=H, json={"provider": "anthropic", "api_key": "sk-ant-secret-1234"})
    assert r.status_code == 200, r.text
    s = c.get("/settings/llm", headers=H).json()
    assert s["tenant"]["key_hint"] == "1234" and "api_key" not in s["tenant"]
    eff = s["effective"]
    assert (eff["provider"], eff["source"], eff["chat_model"]) == ("anthropic", "tenant", "claude-opus-5-5")
    from pf_agent.db import LlmSetting, session
    with session() as ss:
        row = ss.get(LlmSetting, "t:tenant-a")
        assert "secret" not in row.key_enc
    from pf_agent import llmconf
    assert llmconf.resolve("tenant-a").api_key == "sk-ant-secret-1234"
    # 他のテナントには効かない
    assert llmconf.resolve("tenant-b").provider == "stub"
    # キーを空で送ると据え置き、モデルだけ変わる
    c.put("/settings/llm/tenant", headers=H, json={"provider": "anthropic", "chat_model": "claude-sonnet-5-5"})
    assert llmconf.resolve("tenant-a").api_key == "sk-ant-secret-1234"
    assert llmconf.resolve("tenant-a").chat_model == "claude-sonnet-5-5"
    # 既定に戻す
    c.put("/settings/llm/tenant", headers=H, json={"provider": "inherit"})
    assert c.get("/settings/llm", headers=H).json()["tenant"] is None
    from sqlalchemy import select

    from pf_agent.db import AuditLog
    with session() as ss:
        bodies = [r.body for r in ss.execute(select(AuditLog).where(AuditLog.kind == "settings.llm")).scalars()]
    assert bodies and all("sk-ant" not in json.dumps(b) for b in bodies)


def test_app_default_and_vertex_permission(client):
    c = client
    assert c.put("/settings/llm/app", headers=H, json={"provider": "stub"}).status_code == 403
    # テナントは許可がなければ Vertex を選べない
    assert c.put("/settings/llm/tenant", headers=H, json={"provider": "vertex"}).status_code == 403
    r = c.put("/settings/llm/app", headers=ADMIN, json={"provider": "vertex", "location": "global",
                                                        "allow_tenant_vertex": True})
    assert r.status_code == 200, r.text
    s = c.get("/settings/llm", headers=ADMIN).json()
    assert s["is_admin"] and s["app"]["provider"] == "vertex"
    # テナントは既定（Vertex）を引き継ぐ
    eff = c.get("/settings/llm", headers=H).json()["effective"]
    assert eff["provider"] == "vertex" and eff["source"] == "app"
    # 許可されたので選べる。プロジェクトは運用者のものに固定される
    assert c.put("/settings/llm/tenant", headers=H, json={"provider": "vertex", "project": "other",
                                                          "chat_model": "claude-opus-5-5"}).status_code == 200
    from pf_agent import llmconf
    t = llmconf.resolve("tenant-a")
    assert t.project == "my-proj" and t.chat_model == "claude-opus-5-5"
    # 許可を外すと既定に戻る
    c.put("/settings/llm/app", headers=ADMIN, json={"provider": "stub"})
    assert llmconf.resolve("tenant-a").provider == "stub"


def test_tenant_url_must_be_public(client):
    c = client
    for url in ("http://127.0.0.1:11434/v1", "https://localhost/v1", "https://169.254.169.254/v1", "ftp://x/"):
        r = c.put("/settings/llm/tenant", headers=H, json={"provider": "openai", "base_url": url, "chat_model": "m"})
        assert r.status_code == 422, (url, r.text)


class _FakeOpenAI(BaseHTTPRequestHandler):
    calls: list = []

    def do_POST(self):  # noqa: N802
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        _FakeOpenAI.calls.append({"path": self.path, "auth": self.headers.get("authorization"), "body": body})
        if body.get("response_format", {}).get("type") == "json_schema":  # スキーマ指定に未対応な実装をまねる
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b'{"error":"json_schema unsupported"}')
            return
        content = json.dumps({"reply": "ローカルLLMです", "proposals": [
            {"field": "problem", "value": "家計の締めに時間がかかる", "reason": "対話から"}]}, ensure_ascii=False)
        if body.get("response_format") is None:
            content = "OK"
        out = json.dumps({"choices": [{"message": {"content": "```json\n" + content + "\n```"
                                                   if body.get("response_format") else content}}]}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *a):
        pass


def test_openai_compatible_local_llm_via_app_default(client):
    srv = HTTPServer(("127.0.0.1", 0), _FakeOpenAI)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        c = client
        base = f"http://127.0.0.1:{srv.server_port}/v1"
        r = c.put("/settings/llm/app", headers=ADMIN, json={"provider": "openai", "base_url": base,
                                                            "chat_model": "llama3", "api_key": "local-key"})
        assert r.status_code == 200, r.text
        t = c.post("/settings/llm/test", headers=ADMIN, json={"scope": "app"}).json()
        assert t["ok"] and t["reply"] == "OK" and t["model"] == "llama3"
        pid = c.post("/products", headers=H, json={"name": "x", "idea": "家計簿"}).json()["id"]
        st = c.post(f"/products/{pid}/stages/s01/chat", headers=H, json={"message": "課題を詰めたい"}).json()
        msg = st["chat"][-1]
        assert msg["text"].startswith("ローカルLLMです") and msg["proposals"][0]["field"] == "problem"
        assert "llama3" in msg["actor"]
        last = _FakeOpenAI.calls[-1]
        assert last["path"] == "/v1/chat/completions" and last["auth"] == "Bearer local-key"
        assert last["body"]["response_format"] == {"type": "json_object"}
    finally:
        srv.shutdown()


def test_platform_admin_can_choose_vertex_for_own_tenant(client):
    c = client
    # 全テナントへの許可は出ていない
    assert c.get("/settings/llm", headers=H).json()["allow_tenant_vertex"] is False
    s = c.get("/settings/llm", headers=ADMIN).json()
    assert s["is_admin"] and s["admin_configured"] and s["allow_tenant_vertex"] is True
    r = c.put("/settings/llm/tenant", headers=ADMIN, json={"provider": "vertex", "chat_model": "claude-opus-5-5"})
    assert r.status_code == 200, r.text
    from pf_agent import llmconf
    t = llmconf.resolve("tenant-ops")
    assert (t.provider, t.chat_model, t.project, t.source) == ("vertex", "claude-opus-5-5", "my-proj", "tenant")
    # 一般テナントは選べないまま
    assert c.put("/settings/llm/tenant", headers=H, json={"provider": "vertex"}).status_code == 403
    assert llmconf.resolve("tenant-a").provider == "stub"
