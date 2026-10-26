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
    assert d["issue_notes"]["締め処理"]["body"].count("RA-1") == 1
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
