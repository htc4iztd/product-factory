"""外部情報のリサーチライブラリ：トピックごとの資料室（RL-n）。

- 集める：AI の検索（Gemini の Google 検索。Gemini API / Vertex AI の接続のとき）、RSS・Atom、
  指定したページ（変わったら取り込む）、人が貼った URL や本文。前回の最新記事より後（または指定の期間）だけを足す
- 読む：記事ごとに、要約・発信元・日付・国内/海外・区分・論点（ライブラリの論点から最大3つ）・企業、
  書かれた数字と事実（ファクト。RF-n）を抜き出す。ファクトの引用が原文に見つからなければ「未確認」にする
- まとめる：論点ごとに、記事の要約だけを根拠にまとめる（根拠の RA-n を付ける）。新しい記事が3件以上入った論点は書き直す
- 分析する：期間・地域・区分・論点・企業で絞って集計し、AI に根拠の記事番号つきのレポートを頼める
- 使う：ステージ（②市場分析・③競合分析など）にファクトと論点のまとめを渡す（brief）

更新はジョブ（kind=research）として動かす。
"""

from __future__ import annotations

import csv
import datetime as dt
import hashlib
import html as htmlmod
import io
import ipaddress
import re
import socket
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter
from urllib.parse import urlparse

from pydantic import BaseModel
from sqlalchemy import func, select

from . import jobs, llm, llmconf, repo
from .db import (
    JobRun,
    ResearchArticle,
    ResearchFact,
    ResearchLibrary,
    ResearchNote,
    ResearchPlayer,
    ResearchQuestion,
    ResearchReport,
    session,
)
from .llmconf import Conn

REGIONS = {"domestic": "国内", "overseas": "海外", "unknown": "不明"}
CATEGORIES = {"news": "ニュース", "press": "プレス", "spec": "技術仕様", "public": "公的資料", "other": "その他"}
FACT_KINDS = {
    "survey": "調査結果",
    "market": "市場規模・予測",
    "usage": "利用・取引の実績",
    "company": "企業の数値",
    "price": "価格・料金",
    "rule": "制度・規格",
    "spec": "仕様・数値",
    "other": "その他",
}
DEFAULT_TOPICS = [
    "利用者の受容・信頼",
    "利用・取引の量",
    "事業者の対応",
    "市場規模",
    "価格・収益",
    "規制・制度",
    "その他",
]
DEFAULT_LAYERS = [
    "サービス提供者",
    "プラットフォーム・基盤",
    "決済・金融",
    "規格・標準化団体",
    "規制当局・公的機関",
    "調査・投資家",
]
MAX_NEW = 25  # 1回の更新で読む記事の上限
MAX_BYTES = 3_000_000
REWRITE_AFTER = 3  # 論点のまとめを書き直す、新しい記事の数


class ResearchError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def _today() -> str:
    return dt.date.today().isoformat()


def _next(s, model, tenant: str, **where) -> int:
    q = select(func.max(model.number)).where(model.tenant_id == tenant)
    for k, v in where.items():
        q = q.where(getattr(model, k) == v)
    return (s.execute(q).scalar() or 0) + 1


def _lines(v) -> list[str]:
    if isinstance(v, str):
        v = v.splitlines()
    return [x.strip() for x in (v or []) if str(x).strip()]


# ---------------- ライブラリ ----------------
def library_dict(lib: ResearchLibrary, counts: dict | None = None) -> dict:
    return {
        "id": lib.id,
        "number": lib.number,
        "key": f"RL-{lib.number}",
        "name": lib.name,
        "description": lib.description,
        "instructions": lib.instructions,
        "use_search": lib.use_search,
        "feeds": lib.feeds or [],
        "sites": lib.sites or [],
        "issues": lib.issues or [],
        "issue_defs": lib.issue_defs or {},
        "layers": lib.layers or DEFAULT_LAYERS,
        "topics": lib.topics or DEFAULT_TOPICS,
        "entities": lib.entities or [],
        "since": lib.since,
        "latest": lib.latest,
        "updated_at": lib.updated_at.isoformat() if lib.updated_at else None,
        "created_by": lib.created_by,
        **(counts or {}),
    }


def libraries(tenant: str) -> list[dict]:
    with session() as s:
        libs = list(
            s.execute(
                select(ResearchLibrary).where(ResearchLibrary.tenant_id == tenant).order_by(ResearchLibrary.number)
            ).scalars()
        )
        a = dict(
            s.execute(
                select(ResearchArticle.library_id, func.count())
                .where(ResearchArticle.tenant_id == tenant)
                .group_by(ResearchArticle.library_id)
            ).all()
        )
        f = dict(
            s.execute(
                select(ResearchFact.library_id, func.count())
                .where(ResearchFact.tenant_id == tenant)
                .group_by(ResearchFact.library_id)
            ).all()
        )
    return [library_dict(x, {"articles": a.get(x.id, 0), "facts": f.get(x.id, 0)}) for x in libs]


def _lib(s, tenant: str, number: int) -> ResearchLibrary:
    lib = s.execute(
        select(ResearchLibrary).where(ResearchLibrary.tenant_id == tenant, ResearchLibrary.number == number)
    ).scalar_one_or_none()
    if lib is None:
        raise ResearchError(404, f"RL-{number} はありません")
    return lib


def save_library(tenant: str, user: str, body: dict, number: int | None = None) -> dict:
    name = str(body.get("name") or "").strip()
    if number is None and not name:
        raise ResearchError(422, "名前を入れてください")
    for u in _lines(body.get("feeds")) + _lines(body.get("sites")):
        if not re.match(r"^https?://", u):
            raise ResearchError(422, f"URL は http(s):// で始めてください：{u}")
    if body.get("since") and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(body["since"])):
        raise ResearchError(422, "期間の始まりは YYYY-MM-DD")
    with session() as s:
        if number is None:
            lib = ResearchLibrary(
                tenant_id=tenant, number=_next(s, ResearchLibrary, tenant), name=name, created_by=user
            )
            s.add(lib)
        else:
            lib = _lib(s, tenant, number)
        if name:
            lib.name = name[:200]
        for k in ("description", "instructions"):
            if k in body and body[k] is not None:
                setattr(lib, k, str(body[k])[:5000])
        for k in ("feeds", "sites", "issues", "entities", "layers", "topics"):
            if k in body and body[k] is not None:
                setattr(lib, k, _lines(body[k])[:100])
        if body.get("issue_defs") is not None:
            defs = dict(body["issue_defs"])
            lib.issue_defs = {str(k)[:100]: str(v)[:500] for k, v in defs.items() if str(k).strip()}
        if "use_search" in body and body["use_search"] is not None:
            lib.use_search = bool(body["use_search"])
        if "since" in body:
            lib.since = body["since"] or None
        s.commit()
        out = library_dict(lib)
    repo.log(
        None, None, "human", user, "research.library", {"library": out["key"], "name": out["name"]}, tenant_id=tenant
    )
    return out


# ---------------- 記事・ファクトの一覧 ----------------
def article_dict(a: ResearchArticle) -> dict:
    return {
        "id": a.id,
        "number": a.number,
        "key": f"RA-{a.number}",
        "url": a.url,
        "title": a.title,
        "title_ja": a.title_ja or "",
        "country": a.country or "",
        "publisher": a.publisher,
        "published": a.published,
        "region": a.region,
        "category": a.category,
        "summary": a.summary,
        "issues": a.issues or [],
        "entities": a.entities or [],
        "checked": a.checked,
        "origin": a.origin,
        "memo": a.memo,
        "added_at": a.added_at.isoformat(),
    }


def fact_dict(f: ResearchFact, article: ResearchArticle | None = None) -> dict:
    d = {
        "number": f.number,
        "key": f"RF-{f.number}",
        "date": f.date,
        "kind": f.kind,
        "theme": f.theme,
        "metric": f.metric,
        "value": f.value,
        "scope": f.scope,
        "source": f.source,
        "quote": f.quote,
        "verified": f.verified,
    }
    if article is not None:
        d.update(
            article=f"RA-{article.number}",
            url=article.url,
            title=article.title,
            region=article.region,
            publisher=article.publisher,
        )
    return d


def _filtered(s, tenant: str, lib: ResearchLibrary, flt: dict) -> list[ResearchArticle]:
    q = select(ResearchArticle).where(ResearchArticle.tenant_id == tenant, ResearchArticle.library_id == lib.id)
    rows = list(s.execute(q.order_by(ResearchArticle.published.desc(), ResearchArticle.number.desc())).scalars())

    def ok(a: ResearchArticle) -> bool:
        if flt.get("from") and (a.published or "") < flt["from"]:
            return False
        if flt.get("to") and (a.published or "9999") > flt["to"]:
            return False
        if flt.get("region") and a.region != flt["region"]:
            return False
        if flt.get("category") and a.category != flt["category"]:
            return False
        if flt.get("issue") and flt["issue"] not in (a.issues or []):
            return False
        if flt.get("entity") and flt["entity"] not in (a.entities or []):
            return False
        if flt.get("q"):
            hay = f"{a.title} {a.summary} {a.publisher}"
            if flt["q"].lower() not in hay.lower():
                return False
        return True

    return [a for a in rows if ok(a)]


def library(tenant: str, number: int, flt: dict | None = None) -> dict:
    flt = flt or {}
    with session() as s:
        lib = _lib(s, tenant, number)
        arts = _filtered(s, tenant, lib, flt)
        ids = {a.id: a for a in arts}
        facts = [
            f
            for f in s.execute(
                select(ResearchFact)
                .where(ResearchFact.library_id == lib.id)
                .order_by(ResearchFact.date.desc(), ResearchFact.number.desc())
            ).scalars()
            if f.article_id in ids
        ]
        notes = list(
            s.execute(
                select(ResearchNote).where(ResearchNote.library_id == lib.id).order_by(ResearchNote.id.desc())
            ).scalars()
        )
        total = s.execute(select(func.count()).where(ResearchArticle.library_id == lib.id)).scalar()
        out = library_dict(lib, {"articles": total})
    issue_notes = {}
    for n in notes:
        if n.kind == "issue" and n.title not in issue_notes:
            issue_notes[n.title] = {
                "body": n.body,
                "data": n.data,
                "articles": n.articles,
                "created_at": n.created_at.isoformat(),
            }
    return {
        **out,
        "items": [article_dict(a) for a in arts],
        "facts": [fact_dict(f, ids[f.article_id]) for f in facts],
        "issue_notes": issue_notes,
        "analyses": [
            {
                "id": n.id,
                "title": n.title,
                "body": n.body,
                "filters": n.filters,
                "created_by": n.created_by,
                "created_at": n.created_at.isoformat(),
            }
            for n in notes
            if n.kind == "analysis"
        ][:20],
        "stats": stats(arts, facts),
        "options": {"regions": REGIONS, "categories": CATEGORIES, "fact_kinds": FACT_KINDS},
    }


def stats(arts: list[ResearchArticle], facts: list[ResearchFact]) -> dict:
    """データ分析：月ごと・論点・企業・区分・地域の件数と、ファクトの種類ごとの件数。"""
    by_month = Counter((a.published or "")[:7] for a in arts if a.published)
    return {
        "articles": len(arts),
        "facts": len(facts),
        "by_month": sorted(by_month.items()),
        "by_issue": Counter(i for a in arts for i in (a.issues or [])).most_common(),
        "by_entity": Counter(e for a in arts for e in (a.entities or [])).most_common(30),
        "by_category": Counter(a.category for a in arts).most_common(),
        "by_region": Counter(a.region for a in arts).most_common(),
        "by_fact_kind": Counter(f.kind for f in facts).most_common(),
    }


def facts_csv(tenant: str, number: int, flt: dict) -> str:
    data = library(tenant, number, flt)
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["ID", "日付", "種類", "テーマ", "何の数字か", "値", "対象・範囲", "出典", "記事", "URL", "原文で確認"])
    for f in data["facts"]:
        w.writerow(
            [
                f["key"],
                f["date"] or "",
                FACT_KINDS.get(f["kind"], f["kind"]),
                f["theme"],
                f["metric"],
                f["value"],
                f["scope"],
                f["source"],
                f["article"],
                f["url"],
                "済" if f["verified"] else "未",
            ]
        )
    return "﻿" + out.getvalue()  # Excel で文字化けしないよう BOM を付ける


def set_memo(tenant: str, user: str, article_number: int, memo: str) -> dict:
    with session() as s:
        a = s.execute(
            select(ResearchArticle).where(ResearchArticle.tenant_id == tenant, ResearchArticle.number == article_number)
        ).scalar_one_or_none()
        if a is None:
            raise ResearchError(404, f"RA-{article_number} はありません")
        a.memo = memo[:5000]
        s.commit()
        return article_dict(a)


# ---------------- 取ってくる ----------------
def _public(url: str) -> None:
    u = urlparse(url)
    if u.scheme not in ("http", "https") or not u.hostname:
        raise ResearchError(422, f"URL が正しくありません：{url}")
    for info in socket.getaddrinfo(u.hostname, u.port or 443):
        if not ipaddress.ip_address(info[4][0]).is_global:
            raise ResearchError(422, f"内部ネットワークのアドレスは読めません：{url}")


def fetch(url: str) -> tuple[str, str, str]:
    """(最後の URL, content-type, 本文のテキスト)。公開アドレスだけ。"""
    _public(url)
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; ProductFactory-Research/1.0)",
            "Accept-Language": "ja,en;q=0.8",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as r:  # noqa: S310 - 公開アドレスだけ（上で検査）
        final = r.geturl()
        _public(final)
        ctype = r.headers.get("content-type", "")
        raw = r.read(MAX_BYTES)
    charset = re.search(r"charset=([\w-]+)", ctype) or re.search(rb'charset=["\']?([\w-]+)', raw[:3000])
    enc = (
        (charset.group(1).decode() if isinstance(charset.group(1), bytes) else charset.group(1)) if charset else "utf-8"
    )
    try:
        text = raw.decode(enc, errors="replace")
    except LookupError:
        text = raw.decode("utf-8", errors="replace")
    return final, ctype, text


def html_text(page: str) -> tuple[str, str]:
    """(タイトル, 本文のテキスト)。"""
    title = htmlmod.unescape((re.search(r"<title[^>]*>(.*?)</title>", page, re.S | re.I) or [None, ""])[1]).strip()
    body = re.sub(r"<(script|style|noscript|svg|nav|footer|header)[^>]*>.*?</\1>", " ", page, flags=re.S | re.I)
    body = re.sub(r"<br\s*/?>|</p>|</div>|</li>|</h\d>", "\n", body, flags=re.I)
    body = htmlmod.unescape(re.sub(r"<[^>]+>", " ", body))
    body = "\n".join(x.strip() for x in re.sub(r"[ \t　]+", " ", body).splitlines() if len(x.strip()) > 1)
    return title[:500], body[:60000]


def read_feed(url: str, since: str | None) -> list[dict]:
    _, _, text = fetch(url)
    root = ET.fromstring(text.encode("utf-8", errors="replace"))
    out = []
    for it in root.iter():
        tag = it.tag.split("}")[-1]
        if tag not in ("item", "entry"):
            continue

        def g(name, it=it):
            for ch in it:
                if ch.tag.split("}")[-1] == name:
                    return (ch.text or ch.attrib.get("href") or "").strip()
            return ""

        link = g("link")
        date = _date(g("pubDate") or g("published") or g("updated") or g("date"))
        if link and (not since or not date or date >= since):
            out.append({"url": link, "title": g("title"), "date": date})
    return out


def _date(s: str) -> str | None:
    if not s:
        return None
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return m.group(0)
    try:
        from email.utils import parsedate_to_datetime

        return parsedate_to_datetime(s).date().isoformat()
    except (TypeError, ValueError):
        return None


def search(conn: Conn, lib: ResearchLibrary, since: str | None) -> list[dict]:
    """Gemini の Google 検索（Grounding）で、期間内の記事を探す。Gemini 以外の接続では使えない。"""
    if conn.provider not in ("gemini", "vertex") or conn.chat_model.startswith("claude"):
        return []
    from google.genai import types

    client = llm._genai(conn)
    since_txt = f"{since} より後に公開された" if since else "最近公開された"
    prompt = (
        f"「{lib.name}」について、{since_txt}ニュース記事・プレスリリース・技術仕様・公的資料を探して、"
        f"見つけたものを1行に1件、見出しと公開日で挙げてください。\n集める範囲：{lib.instructions or lib.description}\n"
        + (f"論点：{'、'.join(lib.issues or [])}\n" if lib.issues else "")
        + (f"注目する企業・団体：{'、'.join(lib.entities or [])}\n" if lib.entities else "")
    )
    resp = client.models.generate_content(
        model=conn.chat_model,
        contents=prompt,
        config=types.GenerateContentConfig(tools=[types.Tool(google_search=types.GoogleSearch())]),
    )
    llm._record_gemini(conn.chat_model, resp)
    out = []
    for cand in resp.candidates or []:
        gm = getattr(cand, "grounding_metadata", None)
        for ch in getattr(gm, "grounding_chunks", None) or []:
            web = getattr(ch, "web", None)
            if web is not None and web.uri:
                out.append({"url": web.uri, "title": web.title or ""})
    return out


def grounded(conn: Conn, prompt: str) -> tuple[str, list[dict]]:
    """Gemini の Google 検索つきで答えさせ、本文と出典（URL・題名）を返す。Gemini 以外では使えない。"""
    from google.genai import types

    client = llm._genai(conn)
    resp = client.models.generate_content(
        model=conn.chat_model,
        contents=prompt,
        config=types.GenerateContentConfig(tools=[types.Tool(google_search=types.GoogleSearch())]),
    )
    llm._record_gemini(conn.chat_model, resp)
    srcs, seen = [], set()
    for cand in resp.candidates or []:
        gm = getattr(cand, "grounding_metadata", None)
        for ch in getattr(gm, "grounding_chunks", None) or []:
            web = getattr(ch, "web", None)
            if web is not None and web.uri and web.uri not in seen:
                seen.add(web.uri)
                srcs.append({"u": web.uri, "t": web.title or ""})
    return (resp.text or "").strip(), srcs


def can_search(conn: Conn) -> bool:
    return conn.provider in ("gemini", "vertex") and not conn.chat_model.startswith("claude")


# ---------------- 記事を読む ----------------
class ExFact(BaseModel):
    kind: str  # FACT_KINDS のキー
    theme: str  # ライブラリのテーマから1つ
    metric: str  # 何の数字か
    value: str  # 値（単位つき）
    scope: str  # 対象・範囲
    source: str  # 出典（調査主体など）。記事自身なら空
    date: str  # その数字の時点（YYYY-MM-DD か YYYY-MM か空）
    quote: str  # 原文からそのまま抜いた一文


class ExArticle(BaseModel):
    title: str
    title_ja: str  # 日本語の見出し（原題が日本語ならそのまま）
    publisher: str
    published: str  # YYYY-MM-DD か空
    region: str  # domestic | overseas | unknown
    country: str  # ISO の2文字（JP・US・GB・CN など。分からなければ空）
    category: str  # news | press | spec | public | other
    summary: str  # 3〜5文の要約
    issues: list[str]  # ライブラリの論点から最大3つ
    entities: list[str]  # 本文に名前が出た企業・団体
    facts: list[ExFact]


def analyze(conn: Conn, lib: ResearchLibrary, url: str, title: str, text: str) -> ExArticle:
    if conn.provider == "stub":
        return _stub_analyze(lib, title, text)
    prompt = (
        f"次はリサーチライブラリ「{lib.name}」に入れる記事の本文です。"
        "記事に書かれていることだけをもとに、日本語で項目を埋めてください。\n"
        "- summary は3〜5文。推測や評価を足さない。\n"
        "- issues は次の論点から、この記事が主に扱うものを最大3つ（なければ空）："
        f"{'、'.join(lib.issues or []) or '（論点なし）'}\n"
        "- entities は本文に名前が出た企業・団体（正式名を優先）。"
        + (f"次の名前に当たるものはこの表記にそろえる：{'、'.join(lib.entities or [])}\n" if lib.entities else "\n")
        + "- title_ja は日本語の見出し（原題が外国語なら訳す）。country は話の舞台の国（ISO 2文字）。\n"
        "- facts は、調査結果・市場規模・利用実績・価格・仕様などの数字や確定した事実を1件ずつ。"
        f"kind は {list(FACT_KINDS)} のどれか。theme は次から1つ：{'、'.join(lib.topics or DEFAULT_TOPICS)}。"
        "metric には主語を入れる（例：AIに買い物を任せることに不安な消費者の割合）。"
        "quote には、その根拠になる一文を本文からそのまま写す（言い換えない）。本文にない数字は書かない。\n"
        f"- region は日本国内の話なら domestic、海外なら overseas。category は {list(CATEGORIES)} のどれか。\n\n"
        f"## URL\n{url}\n## 見出し\n{title}\n## 本文\n{text[:40000]}\n"
    )
    return llm._json(conn, conn.summary_model, prompt, ExArticle)


def _stub_analyze(lib: ResearchLibrary, title: str, text: str) -> ExArticle:
    sents = [x.strip() for x in re.split(r"(?<=[。．.!?！？])\s*|\n", text) if x.strip()]
    title = title or (sents[0][:80] if sents else "（見出しなし）")
    facts = []
    for x in sents:
        m = re.search(r"([0-9][0-9,.]*\s*(?:%|％|億円|万円|円|兆円|万人|人|社|件|倍|万|億|ドル))", x)
        if m:
            metric = x[: m.start()].strip(" 、,は：:") or title
            facts.append(
                ExFact(
                    kind="other", theme="", metric=metric[:120], value=m.group(1), scope="", source="", date="", quote=x
                )
            )
    date = _date(text[:2000]) or ""
    jp = bool(re.search(r"[ぁ-ん]", text))
    return ExArticle(
        title=title,
        title_ja=title,
        publisher="",
        published=date,
        region="domestic" if jp else "overseas",
        country="JP" if jp else "",
        category="news",
        summary="。".join(sents[:3])[:400],
        issues=[i for i in (lib.issues or []) if i in text][:3],
        entities=[e for e in (lib.entities or []) if e in text],
        facts=facts[:20],
    )


def add_article(
    s,
    conn: Conn,
    lib: ResearchLibrary,
    user: str,
    url: str,
    title: str,
    text: str,
    origin: str,
    hint_date: str | None = None,
    checked: bool = True,
) -> ResearchArticle:
    ex = analyze(conn, lib, url, title, text)
    a = ResearchArticle(
        tenant_id=lib.tenant_id,
        library_id=lib.id,
        number=_next(s, ResearchArticle, lib.tenant_id),
        url=url[:1000],
        title=(ex.title or title or url)[:500],
        title_ja=(ex.title_ja or "")[:500],
        country=(ex.country or "").upper()[:8],
        publisher=ex.publisher[:200],
        published=_date(ex.published) or hint_date,
        region=ex.region if ex.region in REGIONS else "unknown",
        category=ex.category if ex.category in CATEGORIES else "other",
        summary=ex.summary,
        issues=[i for i in ex.issues if i in (lib.issues or [])][:3],
        entities=list(dict.fromkeys(ex.entities))[:20],
        checked=checked,
        origin=origin,
        content_hash=hashlib.sha256(text.encode()).hexdigest(),
    )
    s.add(a)
    s.flush()
    norm = re.sub(r"\s+", "", text)
    for f in ex.facts[:40]:
        if not f.metric.strip() or not f.value.strip():
            continue
        s.add(
            ResearchFact(
                tenant_id=lib.tenant_id,
                library_id=lib.id,
                article_id=a.id,
                number=_next(s, ResearchFact, lib.tenant_id),
                date=_date(f.date) or a.published,
                kind=f.kind if f.kind in FACT_KINDS else "other",
                theme=f.theme[:100],
                metric=f.metric[:300],
                value=f.value[:100],
                scope=f.scope[:300],
                source=f.source[:300],
                quote=f.quote[:2000],
                verified=bool(f.quote) and re.sub(r"\s+", "", f.quote) in norm,
                added_by=f"ai ({user})",
            )
        )
        s.flush()
    return a


# ---------------- 更新（ジョブ） ----------------
def start_update(tenant: str, user: str, number: int) -> dict:
    with session() as s:
        lib = _lib(s, tenant, number)
        busy = (
            s.execute(
                select(JobRun).where(
                    JobRun.kind == "research", JobRun.tenant_id == tenant, JobRun.status.in_(("queued", "running"))
                )
            )
            .scalars()
            .all()
        )
        if any(j.params.get("library") == lib.id for j in busy):
            raise ResearchError(409, "このライブラリは更新中です")
        lib_id, name = lib.id, lib.name
    conn = llmconf.resolve(tenant)
    job_id = jobs.create(
        "research",
        tenant,
        None,
        user,
        {"library": lib_id, "number": number, "name": name},
        total=3 + MAX_NEW,
        model=conn.summary_model,
        tasks=[
            {"id": "search", "name": "AI の検索", "deps": []},
            {"id": "feeds", "name": "RSS・ページ", "deps": []},
            {"id": "read", "name": "記事を読む・ファクトを抜き出す", "deps": ["search", "feeds"]},
            {"id": "issues", "name": "論点のまとめ", "deps": ["read"]},
            {"id": "players", "name": "プレーヤーの最新の動き", "deps": ["read"]},
        ],
    )
    jobs.dispatch(job_id)
    return jobs.run_dict(job_id)


def run_update(job_id: str) -> None:
    with session() as s:
        j = s.get(JobRun, job_id)
        lib = s.get(ResearchLibrary, j.params["library"])
        user = j.created_by
    conn = llmconf.resolve(lib.tenant_id)
    since = lib.latest or lib.since
    with session() as s:
        known = {
            a.url for a in s.execute(select(ResearchArticle).where(ResearchArticle.library_id == lib.id)).scalars()
        }
        hashes = {
            a.url: a.content_hash
            for a in s.execute(
                select(ResearchArticle).where(ResearchArticle.library_id == lib.id, ResearchArticle.origin == "site")
            ).scalars()
        }
    cands: list[dict] = []
    if lib.use_search:
        jobs.step(job_id, "AI の検索で記事を探しています", advance=False)
        if conn.provider not in ("gemini", "vertex", "stub"):
            jobs.skip_task(job_id, "search", "この接続（Gemini / Vertex AI 以外）では使えません")
            jobs.step(job_id, "検索：この接続（Gemini 以外）では使えないため飛ばしました")
        else:
            try:
                with jobs.task(job_id, "search"):
                    found = search(conn, lib, since)
                    cands += [{**x, "origin": "search"} for x in found]
                    jobs.set_task(job_id, "search", detail=f"{len(found)}件")
                jobs.step(job_id, f"検索：{len(found)}件")
            except jobs.Cancelled:
                raise
            except Exception as e:  # noqa: BLE001  検索の失敗で全体を止めない（工程は失敗として残る）
                jobs.step(job_id, f"検索に失敗：{str(e)[:200]}")
    else:
        jobs.skip_task(job_id, "search", "使わない設定")
        jobs.step(job_id, "検索：使わない設定")
    if not (lib.feeds or lib.sites):
        jobs.skip_task(job_id, "feeds", "RSS・ページの指定なし")
    else:
        with jobs.task(job_id, "feeds"):
            got = 0
            for f in lib.feeds or []:
                try:
                    items = read_feed(f, since)
                    cands += [{**x, "origin": "rss"} for x in items]
                    got += len(items)
                    jobs.step(job_id, f"RSS {f}：{len(items)}件", advance=False)
                except Exception as e:  # noqa: BLE001
                    jobs.step(job_id, f"RSS {f} を読めません：{str(e)[:120]}", advance=False)
            for u in lib.sites or []:
                cands.append({"url": u, "title": "", "origin": "site"})
            jobs.set_task(job_id, "feeds", detail=f"RSS {got}件・ページ {len(lib.sites or [])}件")
    jobs.step(job_id, f"候補 {len(cands)}件を読みます")
    with jobs.task(job_id, "read"):
        added, issues_touched = 0, Counter()
        seen = set()
        for c in cands:
            if added >= MAX_NEW:
                break
            if c["url"] in seen or (c["origin"] != "site" and c["url"] in known):
                continue
            seen.add(c["url"])
            try:
                final, ctype, page = fetch(c["url"])
                if c["origin"] != "site" and final in known:
                    continue
                title, text = html_text(page) if "html" in ctype or "<html" in page[:500].lower() else ("", page)
                if len(text) < 200:
                    jobs.step(job_id, f"本文が短いので飛ばしました：{final}", advance=False)
                    continue
                digest = hashlib.sha256(text.encode()).hexdigest()
                if c["origin"] == "site" and hashes.get(c["url"]) == digest:
                    continue
                if c["origin"] == "site" and c["url"] in hashes:  # ページが変わった：前の記事は残し、新しい版を足す
                    final = c["url"]
                with session() as s:
                    a = add_article(
                        s,
                        conn,
                        s.get(ResearchLibrary, lib.id),
                        user,
                        final,
                        c.get("title") or title,
                        text,
                        c["origin"],
                        hint_date=c.get("date"),
                    )
                    s.commit()
                    issues_touched.update(a.issues or [])
                    known.add(final)
                    added += 1
                    jobs.step(job_id, f"RA-{a.number} {a.title[:60]}")
            except jobs.Cancelled:
                raise
            except Exception as e:  # noqa: BLE001  1件の失敗で止めない
                jobs.step(job_id, f"読めません：{c['url'][:120]}（{str(e)[:120]}）", advance=False)
        with session() as s:
            lib2 = s.get(ResearchLibrary, lib.id)
            latest = s.execute(
                select(func.max(ResearchArticle.published)).where(ResearchArticle.library_id == lib.id)
            ).scalar()
            lib2.latest, lib2.updated_at = latest or lib2.latest, dt.datetime.now(dt.UTC)
            s.commit()
        jobs.set_task(job_id, "read", detail=f"候補 {len(cands)}件・新しい記事 {added}件")
    jobs.step(job_id, f"新しい記事 {added}件")
    with jobs.task(job_id, "issues"):
        rewritten = refresh_issue_notes(lib.tenant_id, lib.id, user, force=False)
        jobs.set_task(job_id, "issues", detail="、".join(rewritten) or "書き直しなし")
    jobs.step(job_id, f"論点のまとめを書き直しました：{'、'.join(rewritten) or 'なし'}")
    with jobs.task(job_id, "players"):
        moved = _refresh_latest(lib.tenant_id, j_number(job_id))
        jobs.set_task(job_id, "players", detail=f"{moved}件")


def j_number(job_id: str) -> int:
    with session() as s:
        return int(s.get(JobRun, job_id).params["number"])


def refresh_issue_notes(tenant: str, lib_id: int, user: str, force: bool) -> list[str]:
    """新しい記事が REWRITE_AFTER 件以上入った論点（まだまとめがない論点を含む）のまとめを書き直す。"""
    with session() as s:
        lib = s.get(ResearchLibrary, lib_id)
        arts = list(s.execute(select(ResearchArticle).where(ResearchArticle.library_id == lib_id)).scalars())
        notes = {}
        for n in s.execute(
            select(ResearchNote)
            .where(ResearchNote.library_id == lib_id, ResearchNote.kind == "issue")
            .order_by(ResearchNote.id)
        ).scalars():
            notes[n.title] = n.articles
    conn = llmconf.resolve(tenant)
    done = []
    for issue in lib.issues or []:
        mine = [a for a in arts if issue in (a.issues or [])]
        if not mine or (not force and issue in notes and len(mine) - notes[issue] < REWRITE_AFTER):
            continue
        data = summarize_issue(conn, lib, issue, mine)
        with session() as s:
            s.add(
                ResearchNote(
                    tenant_id=tenant,
                    library_id=lib_id,
                    kind="issue",
                    title=issue,
                    body=issue_markdown(data),
                    data=data,
                    articles=len(mine),
                    created_by=f"ai ({user})",
                )
            )
            s.commit()
        done.append(issue)
    return done


def _digest(arts: list[ResearchArticle], limit: int = 150) -> str:
    arts = sorted(arts, key=lambda a: a.published or "", reverse=True)[:limit]
    return "\n".join(
        f"[RA-{a.number}] {a.published or '日付不明'}｜{a.publisher}｜{a.title}：{a.summary}" for a in arts
    )


class Claim(BaseModel):
    text: str  # 記事群が主張・報告していること（1文）
    stance: str  # 推進 | 慎重 | 中立
    refs: list[int]  # 根拠の記事番号（RA-12 なら 12）


class IssueSummary(BaseModel):
    headline: str  # この論点で記事群が言っていることの要点（1〜2文）
    claims: list[Claim]  # 5〜8項目
    counter: str  # 反対・慎重な見方、反証（なければ空）
    counter_refs: list[int]
    domestic: str  # 国内の記事が言っていること（なければ空）
    domestic_refs: list[int]
    shift: str  # 時期による変化（読み取れなければ空）


def summarize_issue(conn: Conn, lib: ResearchLibrary, issue: str, arts: list[ResearchArticle]) -> dict:
    """論点のまとめ：要点・主張（立場と根拠）・反対の見方・国内の記事・時期による変化。記事の要約だけを根拠にする。"""
    nums = {a.number for a in arts}
    if conn.provider == "stub":
        top = sorted(arts, key=lambda a: a.published or "", reverse=True)[:6]
        data = IssueSummary(
            headline=f"「{issue}」について{len(arts)}件の記事がある（スタブ）。",
            claims=[Claim(text=a.title_ja or a.title, stance="中立", refs=[a.number]) for a in top],
            counter="",
            counter_refs=[],
            domestic="；".join(a.title for a in top if a.region == "domestic")[:300],
            domestic_refs=[a.number for a in top if a.region == "domestic"],
            shift="",
        )
    else:
        q = (lib.issue_defs or {}).get(issue, "")
        prompt = (
            f"リサーチライブラリ「{lib.name}」の論点「{issue}」"
            + (f"（問い：{q}）" if q else "")
            + "について、下の記事の要約だけを根拠に、記事群が主に何を主張・報告しているかをまとめてください。\n"
            "- headline は要点を1〜2文。claims は5〜8項目で、各項目の stance は 推進・慎重・中立 のどれか、"
            "refs に根拠の記事番号（RA-12 なら 12）を入れる。\n"
            "- counter は反対・慎重な見方や反証。domestic は国内（日本）の記事が言っていること。"
            "shift は時期による変化（読み取れなければ空）。\n- 要約にないことは書かない。\n\n"
            f"{_digest(arts)}"
        )
        data = llm._json(conn, conn.summary_model, prompt, IssueSummary)
    d = data.model_dump()
    for c in d["claims"]:  # 実在しない記事番号は落とす
        c["refs"] = [n for n in c["refs"] if n in nums]
    for k in ("counter_refs", "domestic_refs"):
        d[k] = [n for n in d[k] if n in nums]
    return d


def issue_markdown(d: dict) -> str:
    def refs(ns: list[int]) -> str:
        return "".join(f"［RA-{n}］" for n in ns)

    out = [d.get("headline", "")]
    out += [f"- （{c['stance']}）{c['text']}{refs(c['refs'])}" for c in d.get("claims", [])]
    if d.get("counter"):
        out.append(f"- 反対・慎重な見方：{d['counter']}{refs(d.get('counter_refs', []))}")
    if d.get("domestic"):
        out.append(f"- 国内：{d['domestic']}{refs(d.get('domestic_refs', []))}")
    if d.get("shift"):
        out.append(f"- 時期による変化：{d['shift']}")
    return "\n".join(x for x in out if x)


def analyze_selection(tenant: str, user: str, number: int, flt: dict, question: str) -> dict:
    """絞った記事とファクトを対象に、AI に根拠の記事番号つきのレポートを書かせる。"""
    data_flt = {k: v for k, v in flt.items() if v}
    with session() as s:
        lib = _lib(s, tenant, number)
        arts = _filtered(s, tenant, lib, data_flt)
        ids = {a.id for a in arts}
        facts = [
            f
            for f in s.execute(select(ResearchFact).where(ResearchFact.library_id == lib.id)).scalars()
            if f.article_id in ids
        ]
        lib_name, lib_id = lib.name, lib.id
    if not arts:
        raise ResearchError(409, "条件に合う記事がありません")
    conn = llmconf.resolve(tenant)
    fact_txt = "\n".join(f"[RF-{f.number}] {f.date or ''} {f.metric}：{f.value}（{f.scope}）" for f in facts[:300])
    if conn.provider == "stub":
        body = (
            f"## {question or '概要'}\n{len(arts)}件の記事と{len(facts)}件のファクトを対象にしました（スタブ）。\n"
            + "\n".join(f"- {a.title}［RA-{a.number}］" for a in arts[:10])
        )
    else:
        prompt = (
            f"リサーチライブラリ「{lib_name}」の、条件で絞った記事の要約とファクトです。"
            f"{'次の問いに答える形で' if question else ''}日本語のレポートを Markdown で書いてください。\n"
            + (f"問い：{question}\n" if question else "")
            + "- 主張ごとに根拠の記事番号［RA-12］かファクト番号［RF-3］を付ける。根拠のないことは書かない。\n"
            "- 数字はファクトから引き、時点と範囲を添える。傾向・対立する見方・まだ分からないことを分けて書く。\n\n"
            f"## 記事\n{_digest(arts)}\n\n## ファクト\n{fact_txt}\n"
        )
        body = llm._text(conn, conn.summary_model, prompt).strip()
    with session() as s:
        n = ResearchNote(
            tenant_id=tenant,
            library_id=lib_id,
            kind="analysis",
            title=question or "絞り込んだ記事の分析",
            body=body,
            filters=data_flt,
            articles=len(arts),
            created_by=user,
        )
        s.add(n)
        s.commit()
        return {
            "id": n.id,
            "title": n.title,
            "body": body,
            "filters": data_flt,
            "created_by": user,
            "created_at": n.created_at.isoformat(),
        }


def add_manual(tenant: str, user: str, number: int, url: str, text: str, title: str) -> dict:
    """人が URL か本文を入れて記事を足す。本文があればそれを読み、なければ URL を取りに行く。"""
    url, text = url.strip(), text.strip()
    if not url and not text:
        raise ResearchError(422, "URL か本文を入れてください")
    if not text:
        final, ctype, page = fetch(url)
        t, text = html_text(page) if "html" in ctype or "<html" in page[:500].lower() else ("", page)
        url, title = final, title or t
    conn = llmconf.resolve(tenant)
    with session() as s:
        lib = _lib(s, tenant, number)
        if (
            url
            and s.execute(
                select(ResearchArticle).where(ResearchArticle.library_id == lib.id, ResearchArticle.url == url)
            ).first()
        ):
            raise ResearchError(409, "この URL の記事は既にあります")
        a = add_article(
            s, conn, lib, user, url or f"manual:{hashlib.sha256(text.encode()).hexdigest()[:12]}", title, text, "manual"
        )
        latest = max(filter(None, [lib.latest, a.published]), default=None)
        lib.latest = latest
        s.commit()
        out, lib_id = article_dict(a), lib.id
    refresh_issue_notes(tenant, lib_id, user, force=False)
    _refresh_latest(tenant, number)
    return out


def brief(tenant: str, number: int, flt: dict, limit: int = 40) -> str:
    """ステージに渡す要約：論点のまとめと、条件に合うファクト（新しい順）。"""
    data = library(tenant, number, {k: v for k, v in flt.items() if v})
    lines = [f"# リサーチライブラリ RL-{number}「{data['name']}」から"]
    issue = flt.get("issue")
    for name, note in data["issue_notes"].items():
        if issue and name != issue:
            continue
        lines += [f"## 論点：{name}", note["body"]]
    lines.append("## ファクト（何の数字か：値（対象・範囲／時点）出典記事）")
    for f in data["facts"][:limit]:
        mark = "" if f["verified"] else "【原文未確認】"
        lines.append(
            f"- [{f['key']}] {f['metric']}：{f['value']}（{f['scope'] or '範囲不明'}／{f['date'] or '時点不明'}）"
            f" {f['article']} {mark}"
        )
    return "\n".join(lines)


# ---------------- 画面にまとめて渡す ----------------
def dataset(tenant: str, number: int) -> dict:
    """ライブラリの画面が使うものを一度に返す。絞り込み・集計・分析は画面の側で行う。"""
    base = library(tenant, number)
    with session() as s:
        lib = _lib(s, tenant, number)
        players = list(
            s.execute(
                select(ResearchPlayer).where(ResearchPlayer.library_id == lib.id).order_by(ResearchPlayer.name)
            ).scalars()
        )
        qs = list(
            s.execute(
                select(ResearchQuestion).where(ResearchQuestion.library_id == lib.id).order_by(ResearchQuestion.id)
            ).scalars()
        )
        reports = list(
            s.execute(
                select(ResearchReport).where(ResearchReport.library_id == lib.id).order_by(ResearchReport.number.desc())
            ).scalars()
        )
        anum = dict(
            s.execute(
                select(ResearchArticle.id, ResearchArticle.number).where(ResearchArticle.library_id == lib.id)
            ).all()
        )
    questions: dict[str, list] = {}
    for q in qs:
        questions.setdefault(f"RA-{anum.get(q.article_id)}", []).append(question_dict(q))
    return {
        **base,
        "players": [player_dict(p) for p in players],
        "questions": questions,
        "reports": [report_dict(r) for r in reports],
    }


# ---------------- プレーヤー ----------------
def player_dict(p: ResearchPlayer) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "aliases": p.aliases or [],
        "layer": p.layer,
        "region": p.region,
        "role": p.role,
        "detail": p.detail,
        "stance": p.stance,
        "tags": p.tags or [],
        "latest": p.latest,
        "updated_by": p.updated_by,
    }


def save_player(tenant: str, user: str, number: int, body: dict, player_id: int | None = None) -> dict:
    name = str(body.get("name") or "").strip()
    if not name:
        raise ResearchError(422, "名前を入れてください")
    with session() as s:
        lib = _lib(s, tenant, number)
        dup = s.execute(
            select(ResearchPlayer).where(ResearchPlayer.library_id == lib.id, ResearchPlayer.name == name)
        ).scalar_one_or_none()
        if dup is not None and dup.id != player_id:
            raise ResearchError(409, f"「{name}」は既にあります")
        if player_id is None:
            p = ResearchPlayer(tenant_id=tenant, library_id=lib.id, name=name[:200])
            s.add(p)
        else:
            p = s.get(ResearchPlayer, player_id)
            if p is None or p.library_id != lib.id:
                raise ResearchError(404, "ありません")
            p.name = name[:200]
        p.aliases = _lines(body.get("aliases"))[:20]
        p.tags = _lines(body.get("tags"))[:20]
        for k, n in (("layer", 100), ("region", 8), ("role", 300), ("stance", 100)):
            setattr(p, k, str(body.get(k) or "")[:n])
        p.detail = str(body.get("detail") or "")[:5000]
        p.updated_by = user
        s.commit()
        pid = p.id
    _refresh_latest(tenant, number)
    with session() as s:
        return player_dict(s.get(ResearchPlayer, pid))


def delete_player(tenant: str, number: int, player_id: int) -> None:
    with session() as s:
        lib = _lib(s, tenant, number)
        p = s.get(ResearchPlayer, player_id)
        if p is None or p.library_id != lib.id:
            raise ResearchError(404, "ありません")
        s.delete(p)
        s.commit()


def _player_rx(p: ResearchPlayer) -> re.Pattern:
    parts = []
    for a in [p.name, *(p.aliases or [])]:
        e = re.escape(a)
        # 英数字だけの名前は語の途中に当たらないようにする（Apple が Pineapple に当たらない）
        parts.append(rf"(?<![A-Za-z0-9]){e}(?![A-Za-z0-9])" if re.fullmatch(r"[\x00-\x7f]+", a) else e)
    return re.compile("|".join(parts))


def _refresh_latest(tenant: str, number: int) -> int:
    """プレーヤーの最新の動きを、記事集でいちばん新しい登場記事にする（AI は使わない）。"""
    with session() as s:
        lib = _lib(s, tenant, number)
        arts = sorted(
            s.execute(select(ResearchArticle).where(ResearchArticle.library_id == lib.id)).scalars(),
            key=lambda a: (a.published or "", a.number),
            reverse=True,
        )
        n = 0
        for p in s.execute(select(ResearchPlayer).where(ResearchPlayer.library_id == lib.id)).scalars():
            rx = _player_rx(p)
            hit = next(
                (a for a in arts if rx.search(f"{a.publisher} {a.title} {a.title_ja}") or p.name in (a.entities or [])),
                None,
            )
            if hit is not None:
                first = re.split(r"(?<=。)", hit.summary or "")[0]
                p.latest = {
                    "d": hit.published or "",
                    "text": f"{hit.title_ja or hit.title}：{first}"[:400],
                    "u": hit.url,
                    "article": f"RA-{hit.number}",
                }
                n += 1
        s.commit()
    return n


class ExPlayer(BaseModel):
    name: str
    aliases: list[str]
    layer: str  # ライブラリの層から1つ
    region: str  # ISO 2文字
    role: str  # 役割（1行）
    stance: str  # 推進・様子見・慎重・拒否 など（記事から読めなければ空）


class ExPlayers(BaseModel):
    players: list[ExPlayer]


def suggest_players(tenant: str, user: str, number: int) -> list[dict]:
    """記事によく出る企業・団体のうち、まだ登録していないものを、層と役割つきで足す。"""
    with session() as s:
        lib = _lib(s, tenant, number)
        have = {p.name for p in s.execute(select(ResearchPlayer).where(ResearchPlayer.library_id == lib.id)).scalars()}
        arts = list(s.execute(select(ResearchArticle).where(ResearchArticle.library_id == lib.id)).scalars())
        layers, name = lib.layers or DEFAULT_LAYERS, lib.name
    cnt = Counter(e for a in arts for e in (a.entities or []) if e not in have)
    top = [e for e, n in cnt.most_common(40) if n >= 1][:25]
    if not top:
        return []
    conn = llmconf.resolve(tenant)
    if conn.provider == "stub":
        found = [ExPlayer(name=e, aliases=[], layer=layers[0], region="", role="", stance="") for e in top]
    else:
        ctx = "\n".join(
            f"- {e}：" + "／".join((a.title_ja or a.title) for a in arts if e in (a.entities or []))[:300] for e in top
        )
        prompt = (
            f"リサーチライブラリ「{name}」の記事によく出る企業・団体です。それぞれに、記事中での別の呼び方（aliases）、"
            f"層（次から1つ：{'、'.join(layers)}）、国（ISO 2文字）、役割（1行）、"
            "姿勢（記事から読めれば）を付けてください。"
            "企業・団体でないもの（製品名・一般名詞）は外す。\n\n" + ctx
        )
        found = llm._json(conn, conn.summary_model, prompt, ExPlayers).players
    out = []
    for p in found:
        if p.name in have or not p.name.strip():
            continue
        body = p.model_dump()
        body["layer"] = p.layer if p.layer in layers else layers[-1]
        try:
            out.append(save_player(tenant, f"ai ({user})", number, body))
            have.add(p.name)
        except ResearchError:
            continue
    return out


# ---------------- ファクトを手で足す・消す ----------------
def add_fact(tenant: str, user: str, article_number: int, body: dict) -> dict:
    metric, value = str(body.get("metric") or "").strip(), str(body.get("value") or "").strip()
    if not metric or not value:
        raise ResearchError(422, "「何の数字か」と「値」を入れてください")
    with session() as s:
        a = s.execute(
            select(ResearchArticle).where(ResearchArticle.tenant_id == tenant, ResearchArticle.number == article_number)
        ).scalar_one_or_none()
        if a is None:
            raise ResearchError(404, f"RA-{article_number} はありません")
        f = ResearchFact(
            tenant_id=tenant,
            library_id=a.library_id,
            article_id=a.id,
            number=_next(s, ResearchFact, tenant),
            date=_date(str(body.get("date") or "")) or a.published,
            kind=body.get("kind") if body.get("kind") in FACT_KINDS else "other",
            theme=str(body.get("theme") or "")[:100],
            metric=metric[:300],
            value=value[:100],
            scope=str(body.get("scope") or "")[:300],
            source=str(body.get("source") or "")[:300],
            quote="",
            verified=False,
            added_by=user,
        )
        s.add(f)
        s.commit()
        return fact_dict(f, a)


def delete_fact(tenant: str, fact_number: int) -> None:
    with session() as s:
        f = s.execute(
            select(ResearchFact).where(ResearchFact.tenant_id == tenant, ResearchFact.number == fact_number)
        ).scalar_one_or_none()
        if f is None:
            raise ResearchError(404, f"RF-{fact_number} はありません")
        s.delete(f)
        s.commit()


def question_dict(q: ResearchQuestion) -> dict:
    return {
        "id": q.id,
        "question": q.question,
        "state": q.state,
        "answer": q.answer,
        "basis": q.basis,
        "sources": q.sources or [],
        "message": q.message,
        "job_id": q.job_id,
        "asked_by": q.asked_by,
        "asked_at": q.asked_at.isoformat(),
        "answered_at": q.answered_at.isoformat() if q.answered_at else None,
    }


def report_dict(r: ResearchReport) -> dict:
    return {
        "id": r.id,
        "number": r.number,
        "key": f"RR-{r.number}",
        "kind": r.kind,
        "title": r.title,
        "instructions": r.instructions,
        "status": r.status,
        "data": r.data,
        "sources": r.sources or [],
        "basis": r.basis,
        "error": r.error,
        "checked": r.checked,
        "job_id": r.job_id,
        "created_by": r.created_by,
        "created_at": r.created_at.isoformat(),
    }


jobs.HANDLERS["research"] = run_update
