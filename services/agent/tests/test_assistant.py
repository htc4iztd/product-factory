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


def test_ui_is_prototype_only(client):
    """⑥の UI はプロトタイプだけ：UI のページで話すと、どの URL でもプロトタイプの話になり、画面ごとの UI の
    承認依頼は出ない。工程のエージェント・自動開発は UI を書かない（人の編集・チャットの承認だけ）。"""
    from pf_agent import repo

    c = client
    pid = c.post("/products", headers=H, json={"name": "画面", "idea": "家計簿"}).json()["id"]
    wait_idle(c, pid)
    for path in (f"/p/{pid}/s/s06/ui", f"/p/{pid}/s/s06/ui?page=home", f"/p/{pid}/s/s06/ui?mode=proto"):
        rep = say(c, path, "申込画面を作って").json()["reply"]
        assert rep["context"]["kind"] == "ui" and rep["context"]["proto"] is True
        assert all(a["type"] != "ui_page" for a in rep["actions"])
    before = repo.draft(pid, "s06").get("ui")
    repo.set_field(pid, "s06", "ui", {"pages": [{"id": "x", "name": "x", "html": "<p>x</p>"}]}, "s06", "agent")
    repo.set_fields(pid, "s06", {"ui": {"pages": [{"id": "y", "name": "y", "html": "<p>y</p>"}]}}, "s06", "pre-product")
    assert repo.draft(pid, "s06").get("ui") == before
    repo.set_field(pid, "s06", "ui", {"pages": [], "proto": {"html": "<html><body><h1>見本</h1></body></html>"}},
                   "owner@example.com", "edit")
    st = c.get(f"/products/{pid}/stages/s06", headers=H).json()
    assert "プロトタイプ（画面の移り方まで操作できる1つの HTML）：見本" in st["markdown"]
    big = {"pages": [{"id": "x", "name": "x", "html": "a" * 300_001}]}
    assert c.put(f"/products/{pid}/stages/s06/draft", headers=H, json={"field": "ui", "value": big}).status_code in (
        400,
        422,
    )


def test_ui_proto(client):
    """プロトタイプ（1つの HTML）：保存しても画面ごとの UI は残る。AI に作らせると設計PM が承認依頼を出し、
    承認すると入る。コメントを AI に送ると一部だけの書き換え（edits）の承認依頼が出て、
    承認でコメントは反映済みになる。"""
    from pf_agent import proto, repo

    c = client
    pid = c.post("/products", headers=H, json={"name": "動く見本", "idea": "家計簿"}).json()["id"]
    wait_idle(c, pid)
    repo.set_field(pid, "s06", "ui", {"pages": [{"id": "home", "name": "ホーム", "html": "<main>h</main>"}]},
                   "owner@example.com", "human")
    repo.set_field(pid, "s06", "screens", [{"id": "SC-01", "name": "ホーム", "purpose": "残りを見る"},
                                           {"id": "SC-02", "name": "明細", "purpose": "中身を見る"}],
                   "owner@example.com", "human")
    # AI に作らせる（ジョブ）→ 設計PM の承認依頼 → 承認で入る
    j = c.post(f"/products/{pid}/ui/proto/generate", headers=H, json={"note": "スマホで"}).json()
    wait_idle(c, pid)
    assert c.get(f"/jobs/{j['id']}", headers=H).json()["status"] == "done"
    msgs = c.get(f"/assistant/messages?product={pid}", headers=H).json()
    m = next(x for x in msgs if any(a["type"] == "ui_proto" for a in x["actions"]))
    a = m["actions"][0]
    assert m["agent"] == "pm_design" and '"next": "sc02"' in a["preview"]["doc"]
    c.post(f"/assistant/messages/{m['id']}/actions/{a['id']}", headers=H, json={"approve": True})
    ui = repo.draft(pid, "s06")["ui"]
    assert "明細" in ui["proto"]["html"] and ui["proto"]["source"] == "ai" and ui["pages"][0]["id"] == "home"
    # コメントを保存（HTML はそのまま）。画面ごとの UI も残る
    cm = {"id": "c1", "target": "div > button", "label": "ボタン「次へ」", "text": "もっと目立たせて",
          "status": "sent", "context": "ホーム", "by": "owner@example.com"}
    r = c.put(f"/products/{pid}/ui/proto", headers=H, json={"comments": [cm]}).json()
    assert r["comments"][0]["context"] == "ホーム" and "明細" in r["html"]
    # 開いているプロトタイプへのコメントを AI に送る → edits の承認依頼 → 承認で反映済み
    rep = say(c, f"/p/{pid}/s/s06/ui?mode=proto", "ボタン「次へ」：もっと目立たせて").json()["reply"]
    a = rep["actions"][0]
    assert len(rep["actions"]) == 1 and a["type"] == "ui_proto" and a["args"]["edits"]
    assert "もっと目立たせて" in a["preview"]["doc"]
    c.post(f"/assistant/messages/{rep['id']}/actions/{a['id']}", headers=H, json={"approve": True})
    pr = proto.get(pid)
    assert "（スタブ）修正" in pr["html"] and pr["comments"][0]["status"] == "applied"
    # 画面の部品のエディタの保存（pages だけ）でも、プロトタイプは残る
    c.put(f"/products/{pid}/stages/s06/draft", headers=H, json={"field": "ui", "value": {"pages": []}})
    assert proto.get(pid)["html"] == pr["html"] and repo.draft(pid, "s06")["ui"]["pages"] == []
    # 当てられない書き換えは止める
    with pytest.raises(proto.ProtoError):
        proto.apply_edits("<p>a</p><p>a</p>", [{"old": "<p>a</p>", "new": "x"}])
    assert c.put(f"/products/{pid}/ui/proto", headers=H, json={"html": "ただの文字"}).status_code == 422
    assert c.put(f"/products/{pid}/ui/proto", headers=VIEWER, json={"html": "<html></html>"}).status_code == 403
