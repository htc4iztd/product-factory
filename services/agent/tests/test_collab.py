"""チーム：チケット・スレッド・決定記録（会話から抜き出して確定）・会議の議事録・外部の会話の取り込み・通知。"""
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


def test_tickets_and_permissions(client):
    c = client
    pid = product(c)
    base = f"/products/{pid}"
    t = c.post(base + "/tickets", headers=H, json={"title": "US-03 の決済を作る", "assignee": "bob@example.com",
                                                    "priority": "P1"}).json()
    assert t["key"] == "TK-1" and t["refs"] == ["US-03"] and t["status"] == "todo"
    assert c.post(base + "/tickets", headers=H, json={"title": "x", "status": "nope"}).status_code == 422
    assert c.post(base + "/tickets", headers=VIEWER, json={"title": "x"}).status_code == 403
    assert c.get(base + "/tickets", headers=OTHER).status_code == 404
    t2 = c.patch(base + "/tickets/1", headers=BOB, json={"status": "doing"}).json()
    assert t2["status"] == "doing" and t2["assignee"] == "bob@example.com"
    c.post(base + "/tickets/1/comments", headers=BOB, json={"body": "着手しました @owner@example.com"})
    d = c.get(base + "/tickets/1", headers=H).json()
    assert d["comments"][0]["mentions"] == ["owner@example.com"]
    # 担当の割り当てとメンションが通知になる（自分の操作は通知しない）
    assert c.get("/notices", headers=BOB).json()["items"][0]["kind"] == "assigned"
    n = c.get("/notices", headers=H).json()
    assert n["unread"] == 1 and n["items"][0]["link"] == f"/p/{pid}/tickets/1"
    c.post("/notices/read", headers=H)
    assert c.get("/notices", headers=H).json()["unread"] == 0


def test_thread_to_decision_feeds_stage_chat(client):
    c = client
    pid = product(c)
    base = f"/products/{pid}"
    ch = c.get(base + "/channels", headers=H).json()
    assert ch[0]["name"] == "全体"
    cid = ch[0]["id"]
    root = c.post(base + f"/channels/{cid}/posts", headers=H, json={"body": "決済はカードだけでいい？"}).json()
    c.post(base + f"/channels/{cid}/posts", headers=BOB,
           json={"body": "決定：最初のリリースはカード決済のみ（US-03）", "parent_id": root["id"]})
    c.post(base + f"/channels/{cid}/posts", headers=BOB,
           json={"body": "宿題：決済会社に見積もりを依頼する（owner@example.com）", "parent_id": root["id"]})
    posts = c.get(base + f"/channels/{cid}/posts", headers=H).json()["posts"]
    assert len(posts) == 1 and posts[0]["replies"] == 2
    ex = c.post(base + f"/threads/{root['id']}/extract", headers=H).json()
    assert [d["key"] for d in ex["decisions"]] == ["DEC-1"] and ex["decisions"][0]["status"] == "proposed"
    assert ex["tickets"][0]["status"] == "triage" and ex["tickets"][0]["assignee"] == "owner@example.com"
    assert c.get(base + f"/threads/{root['id']}", headers=H).json()["decisions"][0]["key"] == "DEC-1"
    # 確定するまではステージに渡らない
    st = c.get(base + "/stages/s06", headers=H).json()
    assert st["decisions"] == []
    r = c.post(base + "/decisions/1/decide", headers=H,
               json={"status": "confirmed", "stage_id": "s06", "create_ticket": True}).json()
    assert r["status"] == "confirmed" and r["ticket"]["refs"][:2] == ["DEC-1", "US-03"]
    st = c.get(base + "/stages/s06", headers=H).json()
    assert st["decisions"][0]["key"] == "DEC-1"
    # ステージの対話の文脈（上流）に入る
    from pf_agent import collab, repo
    ctx = repo.chat_context(pid, "s06", None)
    assert ctx["tenant_id"] == "tenant-a"
    assert collab.stage_decisions(pid, "s06", [])[0]["title"].startswith("最初のリリースはカード決済のみ")
    assert c.get(base + "/refs/DEC-1", headers=H).json()["kind"] == "decision"
    assert c.post(base + "/decisions/1/decide", headers=H, json={"status": "proposed"}).status_code == 422


def test_meeting_minutes(client):
    c = client
    pid = product(c)
    base = f"/products/{pid}"
    m = c.post(base + "/meetings", headers=H, json={
        "title": "定例", "attendees": ["owner@example.com", "bob@example.com"], "starts_at": "2026-10-27T10:00"}).json()
    assert m["key"] == "MTG-1"
    assert c.post(base + "/meetings/1/minutes", headers=H).status_code == 409   # 記録がない
    c.put(base + "/meetings/1", headers=H, json={"transcript": "owner: 決定：通知はメールのみ（FR-02）\n"
                                                              "bob: 宿題：文面を用意する（bob@example.com）"})
    mt = c.post(base + "/meetings/1/minutes", headers=H).json()
    assert "## 決定（確定待ち）" in mt["minutes"] and "DEC-1" in mt["minutes"]
    assert mt["decisions"][0]["source"] == {"kind": "meeting", "id": "MTG-1"}
    assert mt["tickets"][0]["assignee"] == "bob@example.com"


def test_external_import_copy_and_summary(client):
    c = client
    pid = product(c)
    base = f"/products/{pid}"
    bad = c.post(base + "/channels", headers=H, json={"name": "x", "external": {"provider": "zzz", "mode": "copy"}})
    assert bad.status_code == 422
    cp = c.post(base + "/channels", headers=H, json={"name": "teams-dev", "external": {
        "provider": "teams", "mode": "copy", "url": "https://teams.example/ch"}}).json()
    sm = c.post(base + "/channels", headers=H, json={"name": "gchat-biz", "external": {
        "provider": "gchat", "mode": "summary"}}).json()
    items = [{"author": "alice", "body": "価格はいくら？"}, {"author": "bob", "body": "決定：月額480円にする"}]
    r = c.post(base + f"/channels/{cp['id']}/import", headers=H, json={"items": items}).json()
    assert r == {"mode": "copy", "posts": 2}
    assert [p["body"] for p in c.get(base + f"/channels/{cp['id']}/posts", headers=H).json()["posts"]] == \
        ["価格はいくら？", "決定：月額480円にする"]
    r = c.post(base + f"/channels/{sm['id']}/import", headers=H, json={"items": items}).json()
    assert r["mode"] == "summary" and r["decisions"][0]["title"] == "月額480円にする"
    posts = c.get(base + f"/channels/{sm['id']}/posts", headers=H).json()["posts"]
    assert len(posts) == 1 and posts[0]["author"] == "ai" and "Google Chat の会話の要約" in posts[0]["body"]
    # 外部とつながっていないチャンネルには取り込めない
    general = c.get(base + "/channels", headers=H).json()[0]["id"]
    assert c.post(base + f"/channels/{general}/import", headers=H, json={"items": items}).status_code == 409


def test_docs(client):
    c = client
    pid = product(c)
    base = f"/products/{pid}"
    d = c.post(base + "/docs", headers=H, json={"title": "競合メモ", "body": "US-01 と DEC-1 に関係"}).json()
    assert d["key"] == "DOC-1" and d["refs"] == ["US-01", "DEC-1"]
    d = c.put(base + "/docs/1", headers=BOB, json={"body": "書き直し"}).json()
    assert d["body"] == "書き直し" and d["updated_by"] == "bob@example.com" and d["refs"] == []
    assert c.get(base + "/docs", headers=H).json()[0]["title"] == "競合メモ"
