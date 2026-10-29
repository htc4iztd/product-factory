"""資料の取り込み：Excel・Word・PowerPoint を文章にし、ジョブで工程の項目に入れる（空なら直接、値があれば案）。"""

import base64
import importlib
import io
import time
import zipfile

import pytest
from fastapi.testclient import TestClient

from pf_agent import office

H = {"x-pf-internal-token": "t", "x-pf-user": "owner@example.com", "x-pf-tenant": "tenant-a", "x-pf-role": "OWNER"}
VIEWER = {**H, "x-pf-role": "VIEWER"}
M = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
REL = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"'


def _zip(files: dict[str, str]) -> bytes:
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        for k, v in files.items():
            z.writestr(k, v)
    return b.getvalue()


def xlsx() -> bytes:
    return _zip({
        "xl/workbook.xml": f'<workbook {M} {R}><sheets><sheet name="処理仕様" sheetId="1" r:id="rId1"/></sheets>'
                           "</workbook>",
        "xl/_rels/workbook.xml.rels": f'<Relationships {REL}><Relationship Id="rId1" Target="worksheets/sheet1.xml"/>'
                                      "</Relationships>",
        "xl/sharedStrings.xml": f'<sst {M}><si><t>設計方針</t></si><si><r><t>受付は</t></r><r><t>APIで行う</t></r>'
                                "<rPh><t>ウケツケ</t></rPh></si></sst>",
        "xl/worksheets/sheet1.xml": f'<worksheet {M} {R}><sheetData><row r="1"><c r="B1" t="s"><v>0</v></c>'
                                    '<c r="A1" t="inlineStr"><is><t>見出し</t></is></c></row>'
                                    '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="C2"><v>42</v></c></row></sheetData>'
                                    "<drawing r:id=\"rId1\"/></worksheet>",
        "xl/worksheets/_rels/sheet1.xml.rels": f'<Relationships {REL}><Relationship Id="rId1" '
                                               'Target="../drawings/drawing1.xml"/></Relationships>',
        "xl/drawings/drawing1.xml": '<x xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
                                    "<a:p><a:r><a:t>申込を受ける</a:t></a:r></a:p></x>",
    })


def docx() -> bytes:
    w = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    return _zip({"word/document.xml": f"<w:document {w}><w:body>"
                 '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>監視項目</w:t></w:r></w:p>'
                 "<w:p><w:r><w:t>CPU を見る</w:t></w:r></w:p>"
                 "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>対象</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>閾値</w:t></w:r>"
                 "</w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>DB</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r>"
                 "<w:t>80%</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>"})


def pptx() -> bytes:
    ns = ('xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
          'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"')
    slide = (f"<p:sld {ns}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type=\"title\"/></p:nvPr></p:nvSpPr>"
             "<p:txBody><a:p><a:r><a:t>{t}</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:txBody><a:p><a:r><a:t>本文{t}"
             "</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>")
    return _zip({"ppt/slides/slide10.xml": slide.format(t="後"), "ppt/slides/slide2.xml": slide.format(t="前")})


def test_extract_office_formats():
    text, heads = office.extract("仕様.xlsx", xlsx())
    # 列の順に並べ、ふりがなは入れず、図形の文字も拾う
    assert heads == ["シート：処理仕様"]
    assert "見出し | 設計方針" in text and "受付はAPIで行う | 42" in text and "ウケツケ" not in text
    assert "- 申込を受ける" in text
    text, heads = office.extract("a.docx", docx())
    assert heads == ["監視項目"] and "| 対象 | 閾値 |" in text and "| DB | 80% |" in text
    text, heads = office.extract("a.pptx", pptx())
    assert heads == ["スライド 1：前", "スライド 2：後"] and "本文前" in text
    with pytest.raises(office.OfficeError):
        office.extract("a.xls", b"x")
    with pytest.raises(office.OfficeError):
        office.extract("a.docx", b"not a zip")


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/i.db")
    monkeypatch.setenv("PF_INTERNAL_TOKEN", "t")
    monkeypatch.setenv("PF_LLM", "stub")
    from pf_agent import api, db
    importlib.reload(db)
    importlib.reload(api)
    with TestClient(api.app) as c:
        yield c


def wait(c, pid, doc):
    for _ in range(100):
        d = c.get(f"/products/{pid}/imports/{doc}", headers=H).json()
        if d["status"] in ("done", "failed"):
            return d
        time.sleep(0.1)
    raise AssertionError(d)


def test_import_fills_empty_and_proposes_rest(client):
    c = client
    pid = c.post("/products", headers=H, json={"name": "取込", "idea": "申込の受付"}).json()["id"]
    # 設計方針に値がある状態にしておく → 直接は書き換えず案にする
    c.put(f"/products/{pid}/stages/s09/draft", headers=H, json={"field": "overview", "value": "既存の方針"})
    body = {"filename": "仕様.xlsx", "content_b64": base64.b64encode(xlsx()).decode(), "mode": "fill"}
    assert c.post(f"/products/{pid}/imports", headers=VIEWER, json=body).status_code == 403
    d = c.post(f"/products/{pid}/imports", headers=H, json=body).json()
    assert d["kind"] == "xlsx" and d["outline"] == ["シート：処理仕様"]
    d = wait(c, pid, d["id"])
    assert d["status"] == "done", d
    acts = {(r["stage"], r["field"]): r["action"] for r in d["result"]}
    # 「処理仕様」「設計方針」は ⑨ の項目。値のある設計方針は案、空の処理仕様は直接入る
    assert acts[("s09", "overview")] == "proposed" and acts[("s09", "specs")] == "filled"
    st = c.get(f"/products/{pid}/stages/s09", headers=H).json()
    assert st["draft"]["overview"] == "既存の方針" and st["draft"]["specs"][0]["id"] == "PR-01"
    assert any(s["title"] == "資料の取り込み：仕様.xlsx" for s in st["sessions"])
    # ジョブの工程：見分ける → 抜き出す → 入れる
    job = c.get(f"/jobs/{d['job_id']}", headers=H).json()
    assert [t["id"] for t in job["tasks"]][:2] == ["route", "map:s09"] and job["tasks"][-1]["id"] == "apply"
    assert c.get(f"/products/{pid}/imports", headers=H).json()[0]["id"] == d["id"]


def test_import_rejects_bad_input(client):
    c = client
    pid = c.post("/products", headers=H, json={"name": "取込", "idea": "x"}).json()["id"]
    r = c.post(f"/products/{pid}/imports", headers=H, json={"filename": "a.pdf", "content_b64": "eA=="})
    assert r.status_code == 422 and "読める形式" in r.json()["detail"]
    r = c.post(f"/products/{pid}/imports", headers=H, json={"filename": "a.xlsx", "content_b64": "***"})
    assert r.status_code == 422
    r = c.post(f"/products/{pid}/imports", headers=H,
               json={"filename": "a.md", "content_b64": base64.b64encode(b"x").decode(), "stages": ["s99"]})
    assert r.status_code == 422


def test_agents_read_imported_docs(client):
    from pf_agent import imports, repo, team
    c = client
    pid = c.post("/products", headers=H, json={"name": "取込", "idea": "申込の受付"}).json()["id"]
    body = {"filename": "仕様.xlsx", "content_b64": base64.b64encode(xlsx()).decode(), "mode": "propose"}
    d = wait(c, pid, c.post(f"/products/{pid}/imports", headers=H, json=body).json()["id"])
    # 割り当てた工程の担当に掲示板で知らせる
    th = c.get(f"/products/{pid}/board?agent=s09", headers=H).json()["threads"]
    assert any(p["sender"] == "pdm" and p["intent"] == "report" and "仕様.xlsx" in p["text"]
               for t in th for p in t["posts"])
    # 担当は自分の工程に関係する章を読み、司令塔・PM は一覧と割り当て先を読む
    s09 = imports.docs_context(pid, "s09")
    assert f"資料{d['id']}「仕様.xlsx」" in s09 and "受付はAPIで行う" in s09 and "設計方針（案を出した）" in s09
    assert imports.docs_context(pid, "s01") == ""
    assert "→ ⑨アプリケーション設計" in imports.docs_context(pid, "pm")
    from pf_agent.db import Product, session
    with session() as s:
        p = s.get(Product, pid)
        s.expunge(p)
    assert "## 取り込んだ資料" in team._material(p, "s09", repo.runs(pid))
