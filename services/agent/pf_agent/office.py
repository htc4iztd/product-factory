"""Office の資料（Excel・Word・PowerPoint）を、AI が読める文章にする。

外部のライブラリは使わず、ZIP の中の XML を直接読む。
- Excel：シートごとにセルの値を行ごとに「 | 」でつなぐ。図形（処理フローの箱など）の文字も拾う
- Word：見出しは「#」、表は Markdown の表にする
- PowerPoint：スライドごとに文字と表
戻り値は（本文, 見出しの一覧）。本文は「## シート：…」「## スライド n」などで区切る。
"""
from __future__ import annotations

import io
import posixpath
import re
import xml.etree.ElementTree as ET
import zipfile

MAX_FILE = 20 * 1024 * 1024        # 受け付ける大きさ
MAX_UNZIPPED = 200 * 1024 * 1024   # 展開後の合計（ZIP 爆弾を避ける）
MAX_TEXT = 400_000                 # 残す本文の長さ

NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
}
KINDS = {"xlsx": "Excel", "xlsm": "Excel", "docx": "Word", "pptx": "PowerPoint", "md": "テキスト", "txt": "テキスト",
         "csv": "テキスト"}


class OfficeError(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def kind_of(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in KINDS:
        raise OfficeError("読める形式は Excel（.xlsx）・Word（.docx）・PowerPoint（.pptx）・"
                          "テキスト（.md .txt .csv）です")
    return ext


def extract(filename: str, data: bytes) -> tuple[str, list[str]]:
    if len(data) > MAX_FILE:
        raise OfficeError(f"ファイルが大きすぎます（{MAX_FILE // 1024 // 1024}MB まで）")
    ext = kind_of(filename)
    if ext in ("md", "txt", "csv"):
        text = data.decode("utf-8", errors="replace")
        heads = [ln.lstrip("# ").strip() for ln in text.splitlines() if ln.startswith("#")][:200]
        return text[:MAX_TEXT], heads
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise OfficeError("Office の資料として開けません（壊れているか、古い形式 .xls/.doc/.ppt です）") from None
    if sum(i.file_size for i in z.infolist()) > MAX_UNZIPPED:
        raise OfficeError("展開すると大きすぎる資料です")
    if ext in ("xlsx", "xlsm"):
        parts = _xlsx(z)
    elif ext == "docx":
        parts = _docx(z)
    else:
        parts = _pptx(z)
    text = "\n\n".join(f"## {h}\n{b}".rstrip() for h, b in parts if b.strip() or h)
    return text[:MAX_TEXT], [h for h, _ in parts][:200]


def _xml(z: zipfile.ZipFile, name: str) -> ET.Element | None:
    try:
        return ET.fromstring(z.read(name))
    except KeyError:
        return None


def _rels(z: zipfile.ZipFile, part: str) -> dict[str, str]:
    """part の関係（rId → 参照先のパス）。"""
    d, b = posixpath.split(part)
    root = _xml(z, f"{d}/_rels/{b}.rels")
    out = {}
    for r in root if root is not None else []:
        target = r.get("Target", "")
        out[r.get("Id", "")] = (target.lstrip("/") if target.startswith("/")
                                else posixpath.normpath(posixpath.join(d, target)))
    return out


def _texts(el: ET.Element) -> list[str]:
    """DrawingML の段落ごとの文字。"""
    out = []
    for p in el.iter(f"{{{NS['a']}}}p"):
        t = "".join(x.text or "" for x in p.iter(f"{{{NS['a']}}}t")).strip()
        if t:
            out.append(t)
    return out


# ---------------- Excel ----------------
def _col(ref: str) -> int:
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group(0):
        n = n * 26 + ord(ch) - 64
    return n


def _xlsx(z: zipfile.ZipFile) -> list[tuple[str, str]]:
    shared = []
    sst = _xml(z, "xl/sharedStrings.xml")
    if sst is not None:
        for si in sst.findall("m:si", NS):
            # ふりがな（rPh）は本文に入れない
            shared.append("".join(t.text or "" for t in [*si.findall("m:t", NS), *si.findall("m:r/m:t", NS)]))
    wb = _xml(z, "xl/workbook.xml")
    if wb is None:
        raise OfficeError("Excel のブックとして読めません")
    rels = _rels(z, "xl/workbook.xml")
    parts = []
    for sh in wb.findall("m:sheets/m:sheet", NS):
        name, rid = sh.get("name", ""), sh.get(f"{{{NS['r']}}}id", "")
        path = rels.get(rid)
        root = _xml(z, path) if path else None
        if root is None:
            continue
        lines = []
        for row in root.iter(f"{{{NS['m']}}}row"):
            cells = []
            for c in row.findall("m:c", NS):
                t, v = c.get("t"), c.find("m:v", NS)
                if t == "s" and v is not None and (v.text or "").isdigit() and int(v.text) < len(shared):
                    val = shared[int(v.text)]
                elif t == "inlineStr":
                    val = "".join(x.text or "" for x in [*c.findall("m:is/m:t", NS), *c.findall("m:is/m:r/m:t", NS)])
                else:
                    val = v.text if v is not None and v.text is not None else ""
                val = re.sub(r"\s+", " ", val).strip()
                if val:
                    cells.append((_col(c.get("r", "A1")), val))
            if cells:
                lines.append(" | ".join(v for _, v in sorted(cells)))
        # 図形（処理フローの箱・矢印のラベルなど）
        shapes = []
        for dp in (p for p in _rels(z, path).values() if "/drawings/" in p and p.endswith(".xml")):
            d = _xml(z, dp)
            if d is not None:
                shapes += _texts(d)
        body = "\n".join(lines)
        if shapes:
            body += "\n\n### 図形の文字\n" + "\n".join(f"- {s}" for s in shapes)
        parts.append((f"シート：{name}", body))
    return parts


# ---------------- Word ----------------
def _docx(z: zipfile.ZipFile) -> list[tuple[str, str]]:
    root = _xml(z, "word/document.xml")
    if root is None:
        raise OfficeError("Word の文書として読めません")
    w = NS["w"]
    body = root.find("w:body", NS)
    parts: list[tuple[str, list[str]]] = [("本文", [])]

    def ptext(p: ET.Element) -> str:
        return "".join(t.text or "" for t in p.iter(f"{{{w}}}t")).strip()

    for el in body if body is not None else []:
        if el.tag == f"{{{w}}}p":
            t = ptext(el)
            if not t:
                continue
            style = el.find("w:pPr/w:pStyle", NS)
            sv = (style.get(f"{{{w}}}val") or "") if style is not None else ""
            m = re.search(r"(?:heading|見出し)\s*(\d)", sv, re.I) or re.fullmatch(r"(\d)", sv)
            if m and int(m.group(1)) <= 2:
                parts.append((t, []))
            elif m:
                parts[-1][1].append(f"{'#' * (int(m.group(1)) + 1)} {t}")
            else:
                parts[-1][1].append(t)
        elif el.tag == f"{{{w}}}tbl":
            rows = []
            for tr in el.iter(f"{{{w}}}tr"):
                rows.append([" ".join(ptext(p) for p in tc.iter(f"{{{w}}}p")).strip() for tc in tr.findall("w:tc", NS)])
            parts[-1][1].extend(_md_table(rows))
    return [(h, "\n".join(b)) for h, b in parts if b or h != "本文"]


def _md_table(rows: list[list[str]]) -> list[str]:
    rows = [r for r in rows if any(c for c in r)]
    if not rows:
        return []
    n = max(len(r) for r in rows)
    fmt = lambda r: "| " + " | ".join((r + [""] * n)[:n]).replace("\n", " ") + " |"  # noqa: E731
    return [fmt(rows[0]), "|" + "---|" * n] + [fmt(r) for r in rows[1:]]


# ---------------- PowerPoint ----------------
def _pptx(z: zipfile.ZipFile) -> list[tuple[str, str]]:
    slides = sorted((n for n in z.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)),
                    key=lambda n: int(re.search(r"(\d+)", n.rsplit("/", 1)[1]).group(1)))
    if not slides:
        raise OfficeError("PowerPoint のスライドが見つかりません")
    parts = []
    for i, name in enumerate(slides, 1):
        root = _xml(z, name)
        lines, title = [], ""
        for sp in root.iter(f"{{{NS['p']}}}sp"):
            ph = sp.find(".//p:nvPr/p:ph", NS)
            ts = _texts(sp)
            if ph is not None and ph.get("type") in ("title", "ctrTitle") and ts and not title:
                title = " ".join(ts)
            else:
                lines += ts
        for tbl in root.iter(f"{{{NS['a']}}}tbl"):
            rows = [[" ".join(_texts(tc)) for tc in tr.findall("a:tc", NS)] for tr in tbl.findall("a:tr", NS)]
            lines += _md_table(rows)
        parts.append((f"スライド {i}" + (f"：{title}" if title else ""), "\n".join(lines)))
    return parts
