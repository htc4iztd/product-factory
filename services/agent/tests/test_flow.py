"""対話で下書きを作り、確定・承認し、変更が下流に伝わることを API 経由で確かめる。"""
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


def new_product(c, **kw):
    body = {"name": "テスト", "idea": "共働き世帯の家計簿アプリ", **kw}
    return c.post("/products", headers=H, json=body).json()["id"]


def accept_all(c, pid, sid):
    st = c.post(f"/products/{pid}/stages/{sid}/chat", headers=H, json={"message": "下書きを作って"}).json()
    msg = st["chat"][-1]
    assert msg["role"] == "assistant" and msg["proposals"], st["chat"]
    for p in msg["proposals"]:
        r = c.post(f"/products/{pid}/stages/{sid}/proposals", headers=H,
                   json={"message_id": msg["id"], "proposal_id": p["id"], "accept": True})
        assert r.status_code == 200, r.text
    return r.json()


def test_chat_accept_commit_without_approval(client):
    c = client
    pid = new_product(c)
    st = c.get(f"/products/{pid}/stages/s01", headers=H).json()
    assert st["framework"]["view"] == "lean_canvas" and st["status"] == "not_started"
    assert st["approval_required"] is False          # 個人モードの既定は承認なし
    st = accept_all(c, pid, "s01")
    assert st["status"] == "in_progress" and st["missing"] == []
    assert st["draft"]["problem"] and isinstance(st["draft"]["problem"], list)
    st = c.post(f"/products/{pid}/stages/s01/commit", headers=H, json={}).json()
    assert st["status"] == "completed" and st["approved_version"] == 1 and st["dirty"] is False
    assert "## 課題" in c.get(f"/products/{pid}/stages/s01", headers=H).json()["markdown"]
    # 変更がなければ確定し直せない
    assert c.post(f"/products/{pid}/stages/s01/commit", headers=H, json={}).status_code == 409


def test_commit_requires_filled_fields_unless_forced(client):
    c = client
    pid = new_product(c)
    r = c.post(f"/products/{pid}/stages/s02/commit", headers=H, json={})
    assert r.status_code == 422 and "市場規模の推計" in r.json()["detail"]
    st = c.post(f"/products/{pid}/stages/s02/commit", headers=H, json={"force": True}).json()
    assert st["status"] == "completed" and st["audit_findings"]


def test_any_stage_can_start_and_reject_proposal(client):
    c = client
    pid = new_product(c)
    # 順序のロックはない：④から始められる
    st = c.post(f"/products/{pid}/stages/s04/chat", headers=H, json={"message": "下書きを作って"}).json()
    msg = st["chat"][-1]
    first = msg["proposals"][0]
    st = c.post(f"/products/{pid}/stages/s04/proposals", headers=H,
                json={"message_id": msg["id"], "proposal_id": first["id"], "accept": False}).json()
    assert st["chat"][-1]["proposals"][0]["status"] == "rejected"
    assert st["draft"][first["field"]] in ("", [])
    # 処理済みの案は二度処理できない
    r = c.post(f"/products/{pid}/stages/s04/proposals", headers=H,
               json={"message_id": msg["id"], "proposal_id": first["id"], "accept": True})
    assert r.status_code == 409


def test_manual_edit_and_table_coercion(client):
    c = client
    pid = new_product(c)
    rows = [{"item": "売上", "y1": "1,200", "y2": 3000}, {"item": "原価", "y1": 400}]
    st = c.put(f"/products/{pid}/stages/s05/draft", headers=H, json={"field": "pl", "value": rows}).json()
    pl = {r["item"]: r for r in st["draft"]["pl"]}
    assert list(pl) == ["売上", "原価", "販管費"] and pl["売上"]["y1"] == 1200
    assert "| 粗利 | 800" in st["markdown"]
    st = c.put(f"/products/{pid}/stages/s01/draft", headers=H,
               json={"field": "problem", "value": "- 家計の締めに時間がかかる\n- 夫婦で状況が共有できない"}).json()
    assert st["draft"]["problem"] == ["家計の締めに時間がかかる", "夫婦で状況が共有できない"]
    assert c.put(f"/products/{pid}/stages/s01/draft", headers=H,
                 json={"field": "nope", "value": "x"}).status_code == 404


def test_approval_flow_and_recheck(client):
    c = client
    pid = new_product(c)
    c.put(f"/products/{pid}/settings", headers=H, json={"stages": {"s04": {"approval_required": True}}})
    accept_all(c, pid, "s04")
    st = c.post(f"/products/{pid}/stages/s04/commit", headers=H, json={}).json()
    assert st["status"] == "awaiting_approval" and st["pending"]["version"] == 1
    r = c.post(f"/products/{pid}/stages/s04/decide", headers=H, json={"decision": "Request Changes"})
    assert r.status_code == 422  # 理由が必須
    st = c.post(f"/products/{pid}/stages/s04/decide", headers=H,
                json={"decision": "Request Changes", "comment": "北極星指標を具体的に"}).json()
    assert st["status"] == "revising" and st["chat"][-1]["role"] == "feedback"
    c.put(f"/products/{pid}/stages/s04/draft", headers=H, json={"field": "north_star", "value": "週次の締め完了世帯数"})
    c.post(f"/products/{pid}/stages/s04/commit", headers=H, json={})
    st = c.post(f"/products/{pid}/stages/s04/decide", headers=H, json={"decision": "Approve"}).json()
    assert st["status"] == "completed" and st["approved_version"] == 2
    # ⑤を確定したあとで④の確定版を変えると、⑤が「要再確認」になる
    accept_all(c, pid, "s05")
    c.post(f"/products/{pid}/stages/s05/commit", headers=H, json={})
    c.put(f"/products/{pid}/stages/s04/draft", headers=H,
          json={"field": "target_customer", "value": "子育て中の共働き世帯"})
    assert c.get(f"/products/{pid}/stages/s04", headers=H).json()["status"] == "revising"
    c.post(f"/products/{pid}/stages/s04/commit", headers=H, json={})
    c.post(f"/products/{pid}/stages/s04/decide", headers=H, json={"decision": "Approve"})
    ov = c.get(f"/products/{pid}", headers=H).json()
    assert {s["id"]: s["status"] for s in ov["stages"]}["s05"] == "needs_recheck"
    # 内容を変えなくてよければ、確認済みとして確定に戻せる
    st = c.post(f"/products/{pid}/stages/s05/ack", headers=H).json()
    assert st["status"] == "completed" and st["approved_version"] == 1
    kinds = [a["kind"] for a in c.get(f"/products/{pid}/audit", headers=H).json()]
    assert kinds.count("approval") == 3 and "chat.assistant" in kinds


def test_settings_close_stage_and_poc(client):
    c = client
    pid = new_product(c, scope="poc")
    ov = c.get(f"/products/{pid}", headers=H).json()
    enabled = {s["id"]: s["enabled"] for s in ov["stages"]}
    assert enabled["s02"] is False and enabled["s01"] is True
    assert c.post(f"/products/{pid}/stages/s02/chat", headers=H, json={"message": "x"}).status_code == 409
    ov = c.put(f"/products/{pid}/settings", headers=H,
               json={"stages": {"s02": {"enabled": True}, "s07": {"enabled": False}}}).json()
    enabled = {s["id"]: s["enabled"] for s in ov["stages"]}
    assert enabled["s02"] is True and enabled["s07"] is False
    p3 = next(p for p in ov["phases"] if p["id"] == "P3")
    assert p3["active"] == 5
    # 承認待ちのまま承認を外すと、その版で確定する
    c.put(f"/products/{pid}/settings", headers=H, json={"stages": {"s01": {"approval_required": True}}})
    accept_all(c, pid, "s01")
    c.post(f"/products/{pid}/stages/s01/commit", headers=H, json={})
    c.put(f"/products/{pid}/settings", headers=H, json={"stages": {"s01": {"approval_required": False}}})
    assert c.get(f"/products/{pid}/stages/s01", headers=H).json()["status"] == "completed"


def test_gate_review_is_a_record_not_a_lock(client):
    c = client
    pid = new_product(c)
    r = c.post(f"/products/{pid}/phases/P1/review", headers=H, json={"decision": "back", "reason": "競合が浅い",
                                                                       "back_stage": "s03"})
    assert r.status_code == 200, r.text
    st = c.get(f"/products/{pid}/stages/s03", headers=H).json()
    assert st["status"] == "revising" and "競合が浅い" in st["chat"][-1]["text"]
    r = c.post(f"/products/{pid}/phases/P1/review", headers=H, json={"decision": "stop", "reason": "撤退条件に該当"})
    assert c.post(f"/products/{pid}/stages/s01/chat", headers=H, json={"message": "x"}).status_code == 409


def test_tenant_isolation(client):
    c = client
    pid = new_product(c)
    other = dict(H, **{"x-pf-tenant": "tenant-b"})
    assert c.get(f"/products/{pid}", headers=other).status_code == 404
    bad = dict(H, **{"x-pf-internal-token": "wrong"})
    assert c.get("/products", headers=bad).status_code == 401
    viewer = dict(H, **{"x-pf-role": "VIEWER"})
    assert c.post("/products", headers=viewer, json={"name": "x"}).status_code == 403


def test_chat_survives_restart(tmp_path, monkeypatch):
    """プロセスを作り直しても、同じ対話セッション（ADK セッション）と履歴で続けられる。"""
    import asyncio
    monkeypatch.setenv("PF_LLM", "stub")
    url = f"sqlite:///{tmp_path}/r.db"
    from pf_agent import repo
    from pf_agent.engine import Engine

    async def go():
        e1 = Engine(url)
        p = e1.create_product("t", "u", "x", "y")
        cid = await e1.chat(p, "s01", "u", "下書きを作って")
        adk = repo.get_session(p.id, "s01", cid).adk_session_id
        e2 = Engine(url)  # 再起動を模す
        assert await e2.chat(e2.product(p.id), "s01", "u", "課題をもっと具体的に") == cid
        assert repo.get_session(p.id, "s01", cid).adk_session_id == adk
        roles = [m["role"] for m in repo.chat(p.id, "s01", cid)]
        assert roles == ["user", "assistant", "user", "assistant"]
        ev = await e2.sessions.get_session(app_name="product-factory", user_id=p.id, session_id=adk)
        assert len(ev.events) >= 2
    asyncio.run(go())


def test_chat_sessions_and_report(client):
    c = client
    pid = new_product(c)
    assert c.post(f"/products/{pid}/stages/s01/report", headers=H).status_code == 409   # 対話がまだない
    st = accept_all(c, pid, "s01")
    first = st["session_id"]
    assert [x["title"] for x in st["sessions"]] == ["セッション1"] and st["sessions"][0]["messages"] == 2
    st = c.post(f"/products/{pid}/stages/s01/sessions", headers=H, json={"title": "価格の論点"}).json()
    second = st["session_id"]
    assert second != first and st["chat"] == [] and st["sessions"][0]["title"] == "価格の論点"
    st = c.post(f"/products/{pid}/stages/s01/chat", headers=H,
                json={"message": "課題を直したい", "session_id": second}).json()
    assert st["session_id"] == second and [m["role"] for m in st["chat"]] == ["user", "assistant"]
    # 前のセッションに戻ると、前の対話が見える
    st = c.get(f"/products/{pid}/stages/s01?session={first}", headers=H).json()
    assert st["session_id"] == first and len(st["chat"]) == 2
    c.put(f"/products/{pid}/stages/s01/sessions/{first}", headers=H, json={"title": "最初の下書き"})
    st = c.post(f"/products/{pid}/stages/s01/report", headers=H).json()
    rep = st["report"]
    assert rep["newer_messages"] == 0 and "## 決まったこと（採用した案）" in rep["content"]
    assert "課題：" in rep["content"] and "## 未決事項・次に詰めること" in rep["content"]
    c.post(f"/products/{pid}/stages/s01/chat", headers=H, json={"message": "もう一度", "session_id": second})
    assert c.get(f"/products/{pid}/stages/s01", headers=H).json()["report"]["newer_messages"] == 2


def test_product_canvas_images(client):
    c = client
    pid = new_product(c)
    accept_all(c, pid, "s01")
    cv = c.get(f"/products/{pid}/canvas", headers=H).json()
    assert {f["label"] for f in cv["facts"]} >= {"課題", "独自の価値提案"} and cv["images"] == []
    assert all(f["source"] == "下書き" for f in cv["facts"])
    r = c.post(f"/products/{pid}/images", headers=H, json={"kind": "scene", "note": "朝の食卓"})
    assert r.status_code == 200, r.text
    first = r.json()["image_id"]
    assert r.json()["product"]["cover_image_id"] == first   # 最初の1枚は表紙になる
    assert "no text" in r.json()["images"][0]["prompt"] and "朝の食卓" in r.json()["images"][0]["prompt"]
    raw = c.get(f"/products/{pid}/images/{first}", headers=H)
    assert raw.status_code == 200 and raw.headers["content-type"].startswith("image/svg+xml")
    assert b"<script" not in raw.content
    second = c.post(f"/products/{pid}/images", headers=H, json={"kind": "ui"}).json()["image_id"]
    cv = c.put(f"/products/{pid}/cover", headers=H, json={"image_id": second}).json()
    assert cv["product"]["cover_image_id"] == second
    cv = c.delete(f"/products/{pid}/images/{second}", headers=H).json()
    assert cv["product"]["cover_image_id"] is None and len(cv["images"]) == 1
    other = dict(H, **{"x-pf-tenant": "tenant-b"})
    assert c.get(f"/products/{pid}/images/{first}", headers=other).status_code == 404
    assert c.post(f"/products/{pid}/images", headers=H, json={"kind": "nope"}).status_code == 422


def test_markdown_round_trip_and_edit(client):
    c = client
    pid = new_product(c)
    for sid in ("s01", "s03", "s05"):
        st = accept_all(c, pid, sid)
        # 何も変えずに文書をそのまま戻しても、値は変わらない
        r = c.put(f"/products/{pid}/stages/{sid}/markdown", headers=H, json={"markdown": st["markdown"]}).json()
        assert r["changed"] == [] and r["stage"]["draft"] == st["draft"], (sid, r["notes"])
    md = c.get(f"/products/{pid}/stages/s01", headers=H).json()["markdown"]
    md = md.replace("- 課題の候補1（仮）", "- 家計の締めに毎月2時間かかる")
    md = md.replace("## 独自の価値提案\n", "## 独自の価値提案\n5分で締まる家計簿\n", 1)
    md += "\n## 余計な見出し\nなにか\n"
    r = c.put(f"/products/{pid}/stages/s01/markdown", headers=H, json={"markdown": md}).json()
    assert set(r["changed"]) == {"problem", "uvp"}
    assert r["stage"]["draft"]["problem"][0] == "家計の締めに毎月2時間かかる"
    assert r["stage"]["draft"]["uvp"].startswith("5分で締まる家計簿")
    assert any("余計な見出し" in n for n in r["notes"])
    # 表：PLの数値を文書で直すと表に反映される（計算行は無視）
    md = c.get(f"/products/{pid}/stages/s05", headers=H).json()["markdown"]
    md = md.replace("| 売上 | 300 | 300 | 300 |", "| 売上 | 1,500 | 3000 | 6000 |")
    r = c.put(f"/products/{pid}/stages/s05/markdown", headers=H, json={"markdown": md}).json()
    pl = {row["item"]: row for row in r["stage"]["draft"]["pl"]}
    assert r["changed"] == ["pl"] and pl["売上"]["y1"] == 1500 and list(pl) == ["売上", "原価", "販管費"]


def test_business_references_in_design_stage(client):
    c = client
    pid = new_product(c)
    accept_all(c, pid, "s01")
    c.post(f"/products/{pid}/stages/s01/commit", headers=H, json={})
    accept_all(c, pid, "s04")      # 下書きのまま
    refs = {r["id"]: r for r in c.get(f"/products/{pid}/stages/s08", headers=H).json()["references"]}
    assert list(refs) == ["s01", "s02", "s03", "s04", "s05"]
    assert refs["s01"]["source"] == "最新版 v1" and "## 課題" in refs["s01"]["markdown"]
    assert refs["s04"]["source"] == "下書き" and "## 北極星指標" in refs["s04"]["markdown"]
    # 自分自身と閉じたステージは出さない
    c.put(f"/products/{pid}/settings", headers=H, json={"stages": {"s02": {"enabled": False}}})
    ids = [r["id"] for r in c.get(f"/products/{pid}/stages/s01", headers=H).json()["references"]]
    assert ids == ["s03", "s04", "s05"]


def test_old_messages_move_to_first_session(client):
    """セッションを持つ前の発言は、最初のセッション「これまでの対話」にまとめる。"""
    from pf_agent import db
    c = client
    pid = new_product(c)
    with db.session() as s:
        s.add(db.ChatMessage(product_id=pid, stage_id="s02", role="user", actor="u", text="昔の発言"))
        s.commit()
    st = c.get(f"/products/{pid}/stages/s02", headers=H).json()
    assert [x["title"] for x in st["sessions"]] == ["これまでの対話"] and st["chat"][0]["text"] == "昔の発言"
    st = c.post(f"/products/{pid}/stages/s02/chat", headers=H, json={"message": "続き"}).json()
    assert [m["text"] for m in st["chat"]][:2] == ["昔の発言", "続き"]


def test_business_requirements_flows(client):
    c = client
    pid = new_product(c)
    st = accept_all(c, pid, "s07")
    assert st["framework"]["view"] == "business_req" and st["missing"] == []
    fl = st["draft"]["flows"][0]
    assert fl["lanes"] == ["顧客", "担当者", "システム"] and {n["type"] for n in fl["nodes"]} >= {"start", "decision"}
    assert "```mermaid" in st["markdown"] and 'n3 -->|"はい"| n4' in st["markdown"]
    # 存在しないノードへの矢印・不明な種類・レーン名での指定はそろえる
    bad = [{"business": "返品", "lanes": ["顧客", "倉庫"],
            "nodes": [{"id": "a", "type": "???", "label": "返品申請", "lane": "倉庫"}, {"id": "b", "label": "検品"}],
            "edges": [{"source": "a", "target": "b"}, {"source": "a", "target": "zzz"}]}]
    st = c.put(f"/products/{pid}/stages/s07/draft", headers=H, json={"field": "flows", "value": bad}).json()
    f0 = st["draft"]["flows"][0]
    assert f0["nodes"][0]["type"] == "task" and f0["nodes"][0]["lane"] == 1 and len(f0["edges"]) == 1
    # 文書から読み戻してもフローは変わらない（フローエディタで編集する）
    r = c.put(f"/products/{pid}/stages/s07/markdown", headers=H, json={"markdown": st["markdown"]}).json()
    assert r["changed"] == [] and any("フローエディタ" in n for n in r["notes"])


def test_trace_story_requirement_test(client):
    c = client
    pid = new_product(c)
    stories = [{"id": "US-01", "activity": "家計を締める", "step": "記録", "story": "夫として支出を記録したい",
                "release": "MVP"},
               {"activity": "家計を締める", "step": "確認", "story": "妻として残高を見たい", "release": "MVP"},
               {"id": "US-01", "story": "重複したID"}]
    st = c.put(f"/products/{pid}/stages/s06/draft", headers=H, json={"field": "stories", "value": stories}).json()
    assert [r["id"] for r in st["draft"]["stories"]] == ["US-01", "US-02", "US-03"]   # 空と重複に番号を振る
    acs = [{"story": "US-01", "given": "ログイン済み", "when": "金額を入れて保存", "then": "一覧に出る"}]
    st = c.put(f"/products/{pid}/stages/s06/draft", headers=H, json={"field": "acceptance", "value": acs}).json()
    assert st["draft"]["acceptance"][0]["id"] == "AC-01"
    assert [i["id"] for i in st["trace"]["items"]] == ["US-02", "US-03"]       # 受入基準のないストーリー
    fr = [{"name": "支出の記録", "stories": "US-01, US-03", "priority": "Must"}]
    st = c.put(f"/products/{pid}/stages/s08/draft", headers=H, json={"field": "functional", "value": fr}).json()
    cov = {i["id"]: i["by"] for i in st["trace"]["items"]}
    assert cov == {"US-01": ["FR-01"], "US-02": [], "US-03": ["FR-01"]}
    nfr = {r["category"] for r in st["draft"]["nonfunctional"]}
    assert "セキュリティ" in nfr and len(nfr) == 6
    # ⑬：⑥の受入基準を取り込み、結果は取り込み直しても残る
    r = c.post(f"/products/{pid}/stages/s13/import-acceptance", headers=H).json()
    assert r["added"] == 1 and r["stage"]["draft"]["coverage"][0]["result"] == "未実施"
    rows = r["stage"]["draft"]["coverage"]
    rows[0]["result"] = "合格"
    c.put(f"/products/{pid}/stages/s13/draft", headers=H, json={"field": "coverage", "value": rows})
    r = c.post(f"/products/{pid}/stages/s13/import-acceptance", headers=H).json()
    assert r["added"] == 0 and r["stage"]["trace"]["counts"] == {"合格": 1}
    ov = c.get(f"/products/{pid}", headers=H).json()
    assert next(p for p in ov["phases"] if p["id"] == "P3")["gate_question"] == "この版で作り始めてよいか"


def test_repo_link_and_code_read(client, monkeypatch):
    """GitHub は呼ばずに、読み取りの経路（つなぐ・一覧・ファイル）を確かめる。"""
    import json as _json

    from pf_agent import code
    calls = []

    def fake_get(path, accept="application/vnd.github+json", token=None):
        calls.append(path)
        if path == "/repos/acme/kakeibo":
            return _json.dumps({"full_name": "acme/kakeibo", "default_branch": "main", "private": False}).encode(), {}
        if path.startswith("/repos/acme/kakeibo/git/trees/main"):
            tree = [{"path": "src", "type": "tree"}, {"path": "src/app.py", "type": "blob", "size": 12}]
            return _json.dumps({"sha": "abc", "truncated": False, "tree": tree}).encode(), {}
        if path.startswith("/repos/acme/kakeibo/contents/src/app.py"):
            return b"print('hi')\n", {}
        raise code.CodeError(404, "見つかりません")
    monkeypatch.setattr(code, "_get", fake_get)
    code._tree_cache.clear()
    c = client
    pid = new_product(c)
    assert c.get(f"/products/{pid}/code/tree", headers=H).status_code == 409   # まだつないでいない
    assert c.put(f"/products/{pid}/repo", headers=H, json={"repo": "bad repo"}).status_code == 422
    r = c.put(f"/products/{pid}/repo", headers=H, json={"repo": "https://github.com/acme/kakeibo.git"}).json()
    assert r["product"]["repo"] == "acme/kakeibo" and r["product"]["repo_branch"] == "main"
    t = c.get(f"/products/{pid}/code/tree", headers=H).json()
    assert [e["type"] for e in t["entries"]] == ["dir", "file"]
    f = c.get(f"/products/{pid}/code/file", headers=H, params={"path": "src/app.py"})
    assert f.status_code == 200 and f.content == b"print('hi')\n"
    assert c.get(f"/products/{pid}/code/file", headers=H, params={"path": "../etc/passwd"}).status_code == 422
    other = dict(H, **{"x-pf-tenant": "tenant-b"})
    assert c.get(f"/products/{pid}/code/tree", headers=other).status_code == 404
    r = c.put(f"/products/{pid}/repo", headers=H, json={"repo": ""}).json()
    assert r["product"]["repo"] is None
