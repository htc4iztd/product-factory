"""社内のオントロジー（編集・AI への受け渡し・SKOS の書き出しと読み込み）と、リサーチライブラリ
（記事の追加・ファクトの抜き出しと原文での確認・RSS からの更新ジョブ・論点のまとめ・分析・CSV・ステージへの要約）。"""

import importlib
import time

import pytest
from fastapi.testclient import TestClient

H = {"x-pf-internal-token": "t", "x-pf-user": "owner@example.com", "x-pf-tenant": "tenant-a", "x-pf-role": "OWNER"}
OTHER = {**H, "x-pf-tenant": "tenant-b"}
VIEWER = {**H, "x-pf-role": "VIEWER"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/f.db")
    monkeypatch.setenv("PF_INTERNAL_TOKEN", "t")
    monkeypatch.setenv("PF_LLM", "stub")
    monkeypatch.delenv("PF_JOB_NAME", raising=False)
    from pf_agent import api, db

    importlib.reload(db)
    importlib.reload(api)
    with TestClient(api.app) as c:
        yield c


def wait(c, job_id, timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        j = c.get(f"/jobs/{job_id}", headers=H).json()
        if j["status"] in ("done", "failed", "cancelled"):
            return j
        time.sleep(0.1)
    raise AssertionError(j)


def test_ontology_edit_context_and_skos_round_trip(client):
    c = client
    a = c.post(
        "/ontology/concepts",
        headers=H,
        json={
            "label": "締め処理",
            "kind": "process",
            "definition": "月末に支出を確定させる作業",
            "aliases": ["月次締め"],
        },
    ).json()
    b = c.post("/ontology/concepts", headers=H, json={"label": "経理部", "kind": "org"}).json()
    assert c.post("/ontology/concepts", headers=H, json={"label": "経理部"}).status_code == 409
    assert c.post("/ontology/concepts", headers=VIEWER, json={"label": "x"}).status_code == 403
    c.post("/ontology/relations", headers=H, json={"source": a["id"], "target": b["id"], "type": "owned_by"})
    assert (
        c.post(
            "/ontology/relations", headers=H, json={"source": a["id"], "target": a["id"], "type": "uses"}
        ).status_code
        == 422
    )
    g = c.get("/ontology", headers=H).json()
    assert len(g["concepts"]) == 2 and g["relations"][0]["type"] == "owned_by"
    assert c.get("/ontology", headers=OTHER).json()["concepts"] == []
    # 文章に別名が出てくると、その概念と関係だけが AI に渡る
    ctx = c.post("/ontology/context", headers=H, json={"text": "月次締めを5分で終わらせたい"}).json()["context"]
    assert "締め処理" in ctx and "経理部" in ctx and "月末に支出を確定" in ctx
    assert c.post("/ontology/context", headers=H, json={"text": "関係ない話"}).json()["context"] == ""
    # ステージの対話の文脈にも入る
    from pf_agent import ontology, repo

    pid = c.post("/products", headers=H, json={"name": "家計簿", "idea": "月次締めを楽にする"}).json()["id"]
    assert repo.chat_context(pid, "s01", None)["tenant_id"] == "tenant-a"
    assert "締め処理" in ontology.context_for("tenant-a", "月次締めを楽にする")
    # SKOS で書き出し、別のテナントに読み込む
    ttl = c.get("/ontology/export?format=turtle", headers=H).text
    assert "skos:prefLabel" in ttl and "月次締め" in ttl
    r = c.post("/ontology/import", headers=OTHER, json={"format": "turtle", "text": ttl}).json()
    assert r == {"created": 2, "updated": 0, "relations": 1}
    jl = c.get("/ontology/export?format=json-ld", headers=OTHER).text
    assert c.post("/ontology/import", headers=OTHER, json={"format": "json-ld", "text": jl}).json()["created"] == 0
    assert (
        c.post("/ontology/import", headers=H, json={"format": "turtle", "text": "これは壊れている"}).status_code == 422
    )
    c.delete(f"/ontology/concepts/{b['id']}", headers=H)
    assert c.get("/ontology", headers=H).json()["relations"] == []


def test_ontology_suggest_from_decisions(client):
    c = client
    pid = c.post("/products", headers=H, json={"name": "x", "idea": "y"}).json()["id"]
    c.post(f"/products/{pid}/decisions", headers=H, json={"title": "「家計ボード」は週次で見る", "confirmed": True})
    r = c.post("/ontology/suggest", headers=H).json()
    assert [x["label"] for x in r["concepts"]] == ["家計ボード"] and r["concepts"][0]["status"] == "proposed"
    assert c.post("/ontology/suggest", headers=H).json()["concepts"] == []  # 二度は出さない


ARTICLE = (
    "<html><head><title>家計簿アプリの利用調査</title></head><body><p>2026-10-20 調査会社による調査。</p>"
    "<p>共働き世帯の48%が家計簿アプリを使っている。</p><p>市場規模は1200億円に達した。</p>"
    "<p>締め処理の手間が課題として挙がった。" + "本文。" * 80 + "</p></body></html>"
)
RSS = (
    "<?xml version='1.0'?><rss><channel><item><title>新しい記事</title><link>https://news.example/a1</link>"
    "<pubDate>Mon, 20 Oct 2026 09:00:00 GMT</pubDate></item><item><title>古い記事</title>"
    "<link>https://news.example/old</link><pubDate>Mon, 01 Sep 2025 09:00:00 GMT</pubDate></item></channel></rss>"
)


def test_research_library_flow(client, monkeypatch):
    c = client
    from pf_agent import research

    lib = c.post(
        "/research",
        headers=H,
        json={
            "name": "家計管理の動向",
            "issues": ["利用実態", "締め処理"],
            "entities": ["調査会社"],
            "feeds": ["https://news.example/rss"],
            "since": "2026-01-01",
        },
    ).json()
    assert lib["key"] == "RL-1"
    assert c.post("/research", headers=H, json={"name": "x", "feeds": ["ftp://bad"]}).status_code == 422
    # 内部のアドレスは読まない
    assert c.post("/research/1/articles", headers=H, json={"url": "http://127.0.0.1/x"}).status_code == 422
    # 本文を貼って足す：要約・論点・企業・ファクト（引用が原文にあれば確認済み）
    a = c.post("/research/1/articles", headers=H, json={"url": "https://manual.example/1", "text": ARTICLE}).json()
    assert a["key"] == "RA-1" and set(a["issues"]) == {"締め処理"} and a["entities"] == ["調査会社"]
    d = c.get("/research/1", headers=H).json()
    vals = {f["value"]: f for f in d["facts"]}
    assert {"48%", "1200億円"} <= set(vals) and vals["48%"]["verified"] and vals["48%"]["article"] == "RA-1"
    assert d["issue_notes"]["締め処理"]["data"]["claims"][0]["refs"] == [1]
    assert (
        c.post("/research/1/articles", headers=H, json={"url": "https://manual.example/1", "text": ARTICLE}).status_code
        == 409
    )

    # 更新ジョブ：RSS の期間内の記事だけを取りに行く
    pages = {
        "https://news.example/rss": ("application/rss+xml", RSS),
        "https://news.example/a1": ("text/html", ARTICLE),
    }
    monkeypatch.setattr(
        research, "fetch", lambda url: (url, *pages[url]) if url in pages else (_ for _ in ()).throw(OSError("404"))
    )
    j = c.post("/research/1/update", headers=H).json()
    j = wait(c, j["id"])
    assert j["status"] == "done", j
    steps = [x["step"] for x in j["log"]]
    assert any("RA-2" in s for s in steps) and not any("old" in s for s in steps)
    assert c.get("/jobs", headers=H).json()["runs"][0]["kind"] == "research"
    ts = {t["id"]: t["status"] for t in j["tasks"]}
    assert ts == {"search": "done", "feeds": "done", "read": "done", "issues": "done", "players": "done"}
    d = c.get("/research/1", headers=H).json()
    assert d["articles"] == 2 and d["latest"] == "2026-10-20"
    # 絞り込み・集計・分析・CSV・ステージへの要約
    assert c.get("/research/1?issue=締め処理", headers=H).json()["stats"]["articles"] == 2
    assert c.get("/research/1?q=存在しない語", headers=H).json()["items"] == []
    rep = c.post(
        "/research/1/analyze", headers=H, json={"question": "利用は広がっているか", "filters": {"issue": "締め処理"}}
    ).json()
    assert "RA-" in rep["body"] and rep["filters"] == {"issue": "締め処理"}
    csv_text = c.get("/research/1/facts.csv", headers=H).text
    assert csv_text.startswith("﻿ID,日付") and "48%" in csv_text
    b = c.get("/research/1/brief", headers=H).json()["brief"]
    assert "RL-1" in b and "[RF-" in b and "論点：締め処理" in b
    # 他のテナントからは見えない
    assert c.get("/research/1", headers=OTHER).status_code == 404 and c.get("/research", headers=OTHER).json() == []


def test_intake_creates_canvas_cover_in_background(client):
    c = client
    p = c.post(
        "/products", headers=H, json={"name": "家計簿", "idea": "共働き世帯の家計簿", "canvas_image": True}
    ).json()
    runs = c.get("/jobs?kind=canvas", headers=H).json()["runs"]
    assert runs and runs[0]["product_id"] == p["id"]
    assert wait(c, runs[0]["id"])["status"] == "done"
    cv = c.get(f"/products/{p['id']}/canvas", headers=H).json()
    assert len(cv["images"]) == 1 and cv["product"]["cover_image_id"] == cv["images"][0]["id"]


def test_research_players_facts_questions_reports(client, monkeypatch):
    c = client
    from pf_agent import research

    c.post(
        "/research",
        headers=H,
        json={
            "name": "家計管理",
            "issues": ["締め処理"],
            "entities": ["調査会社"],
            "issue_defs": {"締め処理": "締めの手間は減っているか"},
            "layers": ["サービス", "調査"],
            "topics": ["利用", "市場規模"],
        },
    )
    c.post("/research/1/articles", headers=H, json={"url": "https://manual.example/1", "text": ARTICLE})
    # プレーヤー：記事の企業から候補を出す → 最新の動きは登場記事から
    ps = c.post("/research/1/players/suggest", headers=H).json()["players"]
    assert [p["name"] for p in ps] == ["調査会社"] and ps[0]["layer"] == "サービス"
    assert ps[0]["latest"]["article"] == "RA-1"
    assert c.post("/research/1/players", headers=H, json={"name": "調査会社"}).status_code == 409
    pid = c.post("/research/1/players", headers=H, json={"name": "Apple", "aliases": ["アップル"]}).json()["id"]
    c.put(f"/research/1/players/{pid}", headers=H, json={"name": "Apple", "layer": "調査", "stance": "推進"})
    # ファクトを手で足す・消す
    f = c.post(
        "/research/articles/1/facts", headers=H, json={"metric": "利用者数", "value": "300万人", "kind": "usage"}
    )
    assert f.status_code == 200 and f.json()["article"] == "RA-1" and not f.json()["verified"]
    assert c.post("/research/articles/1/facts", headers=H, json={"metric": "", "value": "1"}).status_code == 422
    # 記事への質問：ジョブで答える（本文が開けないので要約から、印は none）
    monkeypatch.setattr(research, "fetch", lambda url: (_ for _ in ()).throw(OSError("blocked")))
    from pf_agent import research_jobs

    monkeypatch.setattr(research_jobs, "fetch", research.fetch)
    q = c.post("/research/articles/1/questions", headers=H, json={"question": "誰が調べた？"}).json()
    j = wait(c, q["job_id"])
    assert j["status"] == "done" and j["kind"] == "research-qa", j
    # 調査レポート：3種類
    for kind in ("tech", "industry", "public"):
        r = c.post("/research/1/reports", headers=H, json={"kind": kind, "title": f"{kind} の調査"}).json()
        assert wait(c, r["job_id"])["status"] == "done"
    assert c.post("/research/1/reports", headers=H, json={"kind": "x"}).status_code == 422
    d = c.get("/research/1/data", headers=H).json()
    assert d["issue_defs"] == {"締め処理": "締めの手間は減っているか"} and d["topics"] == ["利用", "市場規模"]
    qa = d["questions"]["RA-1"][0]
    assert qa["state"] == "answered" and qa["basis"] == "none" and "誰が調べた" in qa["answer"]
    assert [r["kind"] for r in d["reports"]] == ["public", "industry", "tech"] and all(
        r["status"] == "done" for r in d["reports"]
    )
    assert d["reports"][2]["data"]["docs"][0]["flow"][0]["src"] == "u" and d["reports"][0]["key"] == "RR-3"
    assert {p["name"] for p in d["players"]} == {"Apple", "調査会社"}
    fact = next(x for x in d["facts"] if x["value"] == "300万人")
    c.delete(f"/research/facts/{fact['number']}", headers=H)
    c.delete(f"/research/questions/{qa['id']}", headers=H)
    c.delete(f"/research/reports/{d['reports'][0]['id']}", headers=H)
    c.delete(f"/research/1/players/{pid}", headers=H)
    d = c.get("/research/1/data", headers=H).json()
    assert len(d["reports"]) == 2 and d["questions"] == {} and len(d["players"]) == 1
    assert all(x["value"] != "300万人" for x in d["facts"])
    # 他のテナント・閲覧のみ
    assert c.get("/research/1/data", headers=OTHER).status_code == 404
    assert c.post("/research/articles/1/questions", headers=VIEWER, json={"question": "x"}).status_code == 403


def test_research_search_many_queries_snippet_fallback_and_period(client, monkeypatch):
    """検索は問いを分けて何度も投げる。本文が開けない記事は検索結果の文章から作り（本文未確認）、
    期間の始まりは最新の記事があっても守る。"""
    c = client
    from pf_agent import research

    c.post(
        "/research",
        headers=H,
        json={"name": "家計管理", "issues": ["締め処理", "利用実態"], "entities": ["調査会社"], "since": "2025-01-01"},
    )
    # 最新の記事（2026-10-20）があっても、期間の始まり（2025-01-01）から探す
    c.post("/research/1/articles", headers=H, json={"url": "https://manual.example/1", "text": ARTICLE})
    seen = {}

    def fake_search(conn, lib, since, on_query=None):
        seen["since"] = since
        return [
            {
                "url": "https://news.example/blocked",
                "site": "news.example",
                "date": "2025-09-01",
                "snippet": "2025-09-01｜家計ニュース｜家計簿アプリの利用が増えた｜"
                "共働き世帯の30%が使っている。締め処理が課題。",
            },
            {
                "url": "https://news.example/old",
                "site": "news.example",
                "snippet": "2024-03-01｜家計ニュース｜昔の記事｜古い話。",
            },
            {"url": "https://news.example/nosnippet", "site": "news.example", "snippet": ""},
        ]

    monkeypatch.setattr(research, "search", fake_search)
    monkeypatch.setattr(research, "fetch", lambda url: (_ for _ in ()).throw(OSError("403 Forbidden")))
    j = wait(c, c.post("/research/1/update", headers=H).json()["id"])
    assert j["status"] == "done", j
    assert seen["since"] == "2025-01-01"
    read = next(t for t in j["tasks"] if t["id"] == "read")
    assert "新しい記事 1件（うち検索結果から 1件）" in read["detail"] and "期間より前 1件" in read["detail"]
    assert "読めない 1件" in read["detail"]
    d = c.get("/research/1/data", headers=H).json()
    new = next(a for a in d["items"] if a["url"] == "https://news.example/blocked")
    assert new["checked"] is False and new["published"] == "2025-09-01" and new["origin"] == "search"
    assert all(not f["verified"] for f in d["facts"] if f["article"] == new["key"])


def test_claude_web_search_agent(client, monkeypatch):
    """Claude の接続では、Claude が Web 検索を繰り返すエージェントとして、期間の区切りごとに記事を集める。
    Vertex AI では基本の Web 検索ツール（web_search_20250305）を使い、pause_turn は送り返して続けさせる。"""
    from types import SimpleNamespace as NS

    from pf_agent import llm, research
    from pf_agent.llmconf import Conn

    wins = research.windows("2025-01-01", today="2026-10-26")
    assert len(wins) == 12 and wins[0][1] == "2026-10-26" and wins[-1][0] == "2025-01-01"
    assert all(wins[i][0] > wins[i + 1][1] for i in range(len(wins) - 1))  # 重ならない

    calls = []

    class Msgs:
        def create(self, **kw):
            calls.append(kw)
            lo, hi = (
                __import__("re")
                .search(r"(\d{4}-\d{2}-\d{2}) から (\d{4}-\d{2}-\d{2})", kw["messages"][0]["content"])
                .groups()
            )
            if len(kw["messages"]) == 1 and len(calls) == 1:  # 最初は検索の途中で止まる
                return NS(stop_reason="pause_turn", usage=None, content=[NS(type="server_tool_use")])
            mid = lo
            body = (
                '```json\n[{"url": "https://news.example/'
                + lo
                + '", "title": "記事 '
                + lo
                + '", "published": "'
                + mid
                + '", "publisher": "報道", "summary": "要点。"},'
                ' {"url": "https://news.example/out", "title": "期間外", "published": "2020-01-01"}]\n```'
            )
            return NS(
                stop_reason="end_turn",
                usage=None,
                content=[
                    NS(
                        type="web_search_tool_result",
                        content=[NS(url=f"https://news.example/{lo}", title="t", page_age="")],
                    ),
                    NS(type="text", text=body),
                ],
            )

    monkeypatch.setattr(llm, "_anthropic", lambda conn: NS(messages=Msgs()))
    conn = Conn(
        provider="vertex",
        chat_model="claude-opus-5-5",
        summary_model="claude-opus-5-5",
        image_model="",
        api_key=None,
        base_url=None,
        project="p",
        location="global",
        source="app",
    )
    lib = NS(
        name="家計管理",
        instructions="",
        description="家計簿",
        issues=["締め処理"],
        issue_defs={},
        entities=["調査会社"],
    )
    log = []
    out = research.search(conn, lib, "2025-01-01", lambda q, w, n, e: log.append((q, w, n)))
    assert calls[0]["tools"] == [{"type": "web_search_20250305", "name": "web_search", "max_uses": 8}]
    assert calls[1]["messages"][1]["role"] == "assistant"  # pause_turn の続き
    assert len(out) == 12 and all(x["url"] != "https://news.example/out" for x in out)  # 期間外は入れない
    assert all(x["date"] and x["snippet"] for x in out) and len(log) == 12  # 新しいのが3件未満なので区切りごとに1回
    conn1p = Conn(**{**conn.__dict__, "provider": "anthropic", "api_key": "k"})
    assert research._web_tool(conn1p, 3)["type"] == "web_search_20260209"
    assert research.can_search(conn1p) and not research.can_search(Conn(**{**conn.__dict__, "provider": "openai"}))


def test_gemini_search_hunts_by_window_until_no_new(client, monkeypatch):
    """Gemini の接続でも、期間の区切りごとに検索を繰り返し、見つけた見出しを伝えて探し直す。
    1件1行の出力と出典（grounding_supports）を対応づけて、URL・見出し・日付・文章にする。"""
    import re as _re
    from types import SimpleNamespace as NS

    from pf_agent import llm, research
    from pf_agent.llmconf import Conn

    prompts = []

    def fake_generate(model, contents, config):
        prompts.append(contents)
        lo = _re.search(r"(\d{4}-\d{2}-\d{2}) から", contents).group(1)
        n = sum(1 for p in prompts if lo in p)  # この区切りで何回目か
        k = 4 if n == 1 else (1 if n == 2 else 0)  # 1回目は4件、2回目は1件（3件未満なので打ち切り）
        lines = [f"{lo}｜報道{i}｜記事 {lo} #{n}-{i}｜要点。" for i in range(k)]
        if "切り口" in contents:
            lines = []
        chunks = [NS(web=NS(uri=f"https://redirect.example/{lo}/{n}/{i}", title="news.example")) for i in range(k)]
        sups = [NS(segment=NS(text=line), grounding_chunk_indices=[i]) for i, line in enumerate(lines)]
        gm = NS(grounding_chunks=chunks, grounding_supports=sups)
        return NS(candidates=[NS(grounding_metadata=gm)], usage_metadata=None, text="\n".join(lines))

    monkeypatch.setattr(llm, "_genai", lambda conn: NS(models=NS(generate_content=fake_generate)))
    conn = Conn(
        provider="vertex",
        chat_model="gemini-3.5-flash",
        summary_model="gemini-3.5-flash",
        image_model="",
        source="app",
        project="p",
        location="global",
    )
    lib = NS(name="家計管理", instructions="", description="家計簿", issues=["締め処理"], issue_defs={}, entities=[])
    log = []
    out = research.search(conn, lib, "2026-07-01", lambda q, w, n, e: log.append((q, w, n)))
    wins = research.windows("2026-07-01")
    assert len(out) == 5 * len(wins)  # 区切りごとに 4 + 1 件
    first = next(x for x in out if x["url"].endswith("/1/0"))
    assert (
        first["title"].startswith("記事 ") and first["site"] == "報道0" and first["date"] and "要点" in first["snippet"]
    )
    second = [p for p in prompts if wins[0][0] in p and "切り口" not in p][1]
    assert "見つけ済み" in second and "記事 " in second  # 2回目は見つけた見出しを伝える
    assert any("論点「締め処理」" in p for p in prompts)  # 論点の切り口でも探す
