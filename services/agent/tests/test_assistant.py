"""ファクトリー全体で1つのチャット：メンションなしは開いているページについて、@ で別のページ・工程・エージェントに。
答えるのは PM かプラットフォーム。変更は「変更前 → 変更後」の承認依頼で、承認したものだけ実行する。"""

import base64
import datetime as dt
import importlib
import time

import pytest
from fastapi.testclient import TestClient

H = {"x-pf-internal-token": "t", "x-pf-user": "owner@example.com", "x-pf-tenant": "tenant-a", "x-pf-role": "OWNER"}
VIEWER = {**H, "x-pf-role": "VIEWER"}
OTHER_USER = {**H, "x-pf-user": "other@example.com"}


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


def wait_idle(c, pid):
    for _ in range(200):
        js = c.get(f"/jobs?product={pid}", headers=H).json()
        rows = js if isinstance(js, list) else js.get("runs", js.get("items", []))
        if not any(r["status"] in ("queued", "running") for r in rows):
            return
        time.sleep(0.1)
    raise AssertionError("jobs still running")


def say(c, path, text, mentions=(), attachments=(), headers=H):
    return c.post(
        "/assistant/messages",
        headers=headers,
        json={"path": path, "text": text, "mentions": list(mentions), "attachments": list(attachments)},
    )


def test_page_context_change_needs_approval(client):
    c = client
    pid = c.post("/products", headers=H, json={"name": "窓口", "idea": "申込の受付"}).json()["id"]
    c.get(f"/products/{pid}/team", headers=H)
    # ⑨の画面で、メンションなし → ⑨について。答えるのは設計 PM。項目の書き換えは承認依頼になる（まだ変わらない）
    r = say(c, f"/p/{pid}/s/s09", "設計方針を「モノリスで作る」にして").json()
    rep = r["reply"]
    assert rep["agent"] == "pm_design" and rep["context"]["kind"] == "stage" and rep["context"]["stage_id"] == "s09"
    a = rep["actions"][0]
    assert (
        a["type"] == "set_field"
        and a["status"] == "pending"
        and a["before"] == "（空）"
        and a["after"] == "モノリスで作る"
    )
    assert c.get(f"/products/{pid}/stages/s09", headers=H).json()["draft"]["overview"] == ""
    # 別の人は答えられない・閲覧のみの人は話せない
    assert (
        c.post(
            f"/assistant/messages/{rep['id']}/actions/{a['id']}", headers=OTHER_USER, json={"approve": True}
        ).status_code
        == 404
    )
    assert say(c, f"/p/{pid}/s/s09", "x", headers=VIEWER).status_code == 403
    # 承認 → 書き換わる。二度は答えられない
    m = c.post(f"/assistant/messages/{rep['id']}/actions/{a['id']}", headers=H, json={"approve": True}).json()
    assert m["actions"][0]["status"] == "approved" and m["actions"][0]["result"] == "書き換えました"
    assert c.get(f"/products/{pid}/stages/s09", headers=H).json()["draft"]["overview"] == "モノリスで作る"
    assert (
        c.post(f"/assistant/messages/{rep['id']}/actions/{a['id']}", headers=H, json={"approve": True}).status_code
        == 409
    )
    # 担当に動いてもらう指示は Issue の起票の承認依頼。否認すれば起票しない
    rep = say(c, f"/p/{pid}/s/s09", "この工程の下書きを作って").json()["reply"]
    a = rep["actions"][0]
    assert a["type"] == "issue_create" and a["title"] == "⑨アプリケーション設計担当に Issue を起票する"
    c.post(f"/assistant/messages/{rep['id']}/actions/{a['id']}", headers=H, json={"approve": False})
    assert c.get(f"/products/{pid}/issues", headers=H).json() == [] or not c.get(
        f"/products/{pid}/issues", headers=H
    ).json().get("issues")
    rep = say(c, f"/p/{pid}/s/s09", "この工程の下書きを作って").json()["reply"]
    m = c.post(
        f"/assistant/messages/{rep['id']}/actions/{rep['actions'][0]['id']}", headers=H, json={"approve": True}
    ).json()
    assert m["actions"][0]["result"].startswith("#1 を起票しました")
    wait_idle(c, pid)
    i = c.get(f"/products/{pid}/issues/1", headers=H).json()
    assert i["author"] == "pm_design" and i["assignee"] in ("s09", "pm_design")
    # PM の作業場所にも記録が残る
    w = c.get(f"/products/{pid}/pm/pm_design", headers=H).json()
    assert any(x["role"] == "pdm" and x["text"] == "この工程の下書きを作って" for x in w["messages"])


def test_mentions_routing_schedule_and_attachments(client):
    c = client
    pid = c.post("/products", headers=H, json={"name": "宛先", "idea": "x"}).json()["id"]
    c.get(f"/products/{pid}/team", headers=H)
    # ダッシュボードから @②市場分析 → ②について、事業 PM が答える
    rep = say(c, f"/p/{pid}", "見直しを確かめて", [{"kind": "stage", "ref": "s02"}]).json()["reply"]
    assert rep["agent"] == "pm_biz" and rep["context"]["stage_id"] == "s02" and rep["context"]["mentioned"]
    # @プラットフォーム・プロダクトの外 → プラットフォーム
    assert (
        say(c, f"/p/{pid}", "動いてる？", [{"kind": "agent", "ref": "platform"}]).json()["reply"]["agent"] == "platform"
    )
    assert say(c, "/", "全体は？").json()["reply"]["agent"] == "platform"
    # スケジュールの画面で → 予定の変更の承認依頼（変更前と変更後）
    rep = say(c, f"/p/{pid}/schedule", "担当を30分ごとにして").json()["reply"]
    a = rep["actions"][0]
    assert rep["agent"] == "platform" and a["type"] == "schedule" and "10分ごと" in a["before"]
    assert a["after"].startswith("30分ごと")
    c.post(f"/assistant/messages/{rep['id']}/actions/{a['id']}", headers=H, json={"approve": True})
    v = c.get(f"/products/{pid}/schedule", headers=H).json()
    assert next(x for x in v["agents"] if x["key"] == "s06")["label"] == "30分ごと"
    # 添付（プロダクトの中で）
    up = c.post(
        f"/products/{pid}/agents/assistant/attachments",
        headers=H,
        json={"filename": "メモ.md", "content_b64": base64.b64encode("# 顧客\n共働き".encode()).decode()},
    ).json()
    m = say(c, f"/p/{pid}/s/s01", "このメモを読んで", attachments=[up["id"]]).json()["message"]
    assert m["attachments"][0]["filename"] == "メモ.md"
    assert say(c, "/", "x", attachments=[up["id"]]).status_code == 422
    # 対話はプロダクトごと：このプロダクトのページではこのプロダクトの対話だけ（プロダクトの外の発言は出ない）
    f = c.get(f"/assistant/messages?product={pid}", headers=H).json()
    mine = [x for x in f if x["role"] == "pdm"]
    assert [x["role"] for x in f[:2]] == ["pdm", "agent"] and len(mine) == 4
    assert all(x["product_id"] == pid for x in f)
    other = c.post("/products", headers=H, json={"name": "別", "idea": "y"}).json()["id"]
    assert c.get(f"/assistant/messages?product={other}", headers=H).json() == []
    say(c, f"/p/{other}/s/s01", "別のプロダクトの話")
    assert all(x["product_id"] == pid for x in c.get(f"/assistant/messages?product={pid}", headers=H).json())
    # プロダクトの外では、プロダクトの外の対話だけ
    outside = c.get("/assistant/messages", headers=H).json()
    assert {x["text"] for x in outside if x["role"] == "pdm"} == {"全体は？"}
    # ほかの人の発言は見えない（テナントの全員への知らせ＝プラットフォームの【要対応】だけは見える）
    assert all(
        x["role"] == "agent" and x["text"].startswith("【ネクストアクションへの合意依頼】")
        for x in c.get(f"/assistant/messages?product={pid}", headers=OTHER_USER).json()
    )
    assert c.get("/assistant/messages?product=nope", headers=H).status_code == 404
    refs = [x["ref"] for x in c.get(f"/assistant/mentions?product={pid}", headers=H).json()]
    assert "platform" in refs and "s06" in refs and f"/p/{pid}/schedule" in refs


def test_platform_alert_reaches_chat_with_approval(client):
    from pf_agent.db import SystemBeat, session

    c = client
    pid = c.post("/products", headers=H, json={"name": "見張り", "idea": "x"}).json()["id"]
    c.get(f"/products/{pid}/team", headers=H)
    with session() as s:
        s.merge(SystemBeat(name="tick", at=dt.datetime.now(dt.UTC) - dt.timedelta(minutes=30), detail=""))
        s.commit()
    c.get(f"/products/{pid}/platform", headers=H)
    feed = c.get(f"/assistant/messages?product={pid}", headers=OTHER_USER).json()
    f = [x for x in feed if x["agent"] == "platform"]
    # テナント全体の問題は、各プロダクトのチャットに出る（プラットフォームはプロダクトごと）。テナントの全員が見られる
    # （対処があるので、ネクストアクションへの合意依頼）
    assert f and f[0]["text"].startswith("【ネクストアクションへの合意依頼】定期実行（tick）が止まっています")
    a = f[0]["actions"][0]
    m = c.post(f"/assistant/messages/{f[0]['id']}/actions/{a['id']}", headers=H, json={"approve": True}).json()
    assert m["actions"][0]["status"] == "approved" and m["actions"][0]["result"].startswith("定期実行を1回動かしました")
    wait_idle(c, pid)


def test_ui_editor_by_chat(client):
    """⑥の UI エディタで話すと、画面の HTML を承認依頼で出し、承認すると UI デザインに入る（手での編集と同じ項目）。"""
    c = client
    pid = c.post("/products", headers=H, json={"name": "画面", "idea": "家計簿"}).json()["id"]
    c.get(f"/products/{pid}/team", headers=H)
    rep = say(c, f"/p/{pid}/s/s06/ui", "申込画面を作って").json()["reply"]
    assert rep["agent"] == "pm_design" and rep["context"]["kind"] == "ui"
    a = rep["actions"][0]
    assert a["type"] == "ui_page" and a["before"] == "（新しい画面）" and "申込" in a["after"]
    assert "pf-btn" in a["preview"]["html"]
    c.post(f"/assistant/messages/{rep['id']}/actions/{a['id']}", headers=H, json={"approve": True})
    st = c.get(f"/products/{pid}/stages/s06", headers=H).json()
    pages = st["draft"]["ui"]["pages"]
    assert len(pages) == 1 and pages[0]["name"] == "申込" and "pf-btn" in pages[0]["html"]
    assert "## UI デザイン" in st["markdown"] and "- 申込：" in st["markdown"]
    # 手で編集（エディタの保存と同じ）：エディタの状態も持つ。もう一度 AI に頼むと同じ画面を書き換える
    pages[0]["project"] = {"pages": [{"frames": []}]}
    c.put(f"/products/{pid}/stages/s06/draft", headers=H, json={"field": "ui", "value": {"pages": pages}})
    rep = say(c, f"/p/{pid}/s/s06/ui", "申込画面を直して").json()["reply"]
    assert rep["actions"][0]["after"]
    big = {"pages": [{"id": "x", "name": "x", "html": "a" * 300_001}]}
    assert c.put(f"/products/{pid}/stages/s06/draft", headers=H, json={"field": "ui", "value": big}).status_code in (
        400,
        422,
    )


def test_ui_comment_to_ai(client):
    """プロトタイプのコメント：保存して残り、開いている画面へのコメントを AI に送ると、その画面を
    書き換える承認依頼が出る。承認すると反映され、送ったコメントは「反映済み」になる。"""
    from pf_agent import repo

    c = client
    pid = c.post("/products", headers=H, json={"name": "画面", "idea": "家計簿"}).json()["id"]
    ui = {"pages": [
        {"id": "home", "name": "ホーム", "screen": "SC-01",
         "html": '<main><button data-go="list">一覧へ</button></main>', "css": "",
         "comments": [{"id": "c1", "target": "main > button", "label": "一覧へ", "x": 40, "y": 20,
                       "text": "ボタンを大きく", "status": "sent", "by": "owner@example.com"}]},
        {"id": "list", "name": "一覧", "screen": "SC-02", "html": "<main><h1>一覧</h1></main>", "css": ""},
    ]}
    repo.set_field(pid, "s06", "ui", ui, "owner@example.com", "human")
    saved = repo.draft(pid, "s06")["ui"]["pages"]
    assert saved[0]["comments"][0]["text"] == "ボタンを大きく" and saved[1]["comments"] == []
    r = say(c, f"/p/{pid}/s/s06/ui?page=home", "「一覧へ」のボタン：ボタンを大きく").json()["reply"]
    a = r["actions"][0]
    assert a["type"] == "ui_page" and a["args"]["page_id"] == "home" and "ボタンを大きく" in a["args"]["html"]
    m = c.post(f"/assistant/messages/{r['id']}/actions/{a['id']}", headers=H, json={"approve": True}).json()
    assert m["actions"][0]["status"] == "approved"
    pages = repo.draft(pid, "s06")["ui"]["pages"]
    assert len(pages) == 2 and "ボタンを大きく" in pages[0]["html"] and 'data-go="list"' in pages[0]["html"]
    assert pages[0]["comments"][0]["status"] == "applied"
