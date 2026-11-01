"""共有ドキュメント（DOC-n）と通知。

ドキュメントは成果物の ID（US-01 など）と同じ書き方で他を参照できる。手で書く Markdown のドキュメントと、
取り込んだ資料（imports.py）は、画面では1つの「ドキュメント」に並ぶ。
チケット・議論（チャンネルとスレッド）・決定記録・会議は廃止した（Issue・振り返りの会議・ドキュメントに一本化）。
"""
from __future__ import annotations

import datetime as dt
import re

from sqlalchemy import func, select

from . import repo
from .db import Doc, Notice, Product, session
from .frameworks import ids_in


class CollabError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def _refs(*texts: str) -> list[str]:
    seen: list[str] = []
    for t in texts:
        for r in ids_in(t):
            if r not in seen:
                seen.append(r)
    return seen


def _next(s, model, product_id: str) -> int:
    return (s.execute(select(func.max(model.number)).where(model.product_id == product_id)).scalar() or 0) + 1


def _iso(d: dt.datetime | None) -> str | None:
    return d.isoformat() if d else None


# ---------------- 共有ドキュメント ----------------
def doc_dict(d: Doc, full: bool = False) -> dict:
    out = {"number": d.number, "key": f"DOC-{d.number}", "title": d.title, "refs": d.refs or [],
           "updated_by": d.updated_by, "updated_at": _iso(d.updated_at)}
    if full:
        out["body"] = d.body
    return out


def docs(product: Product) -> list[dict]:
    with session() as s:
        rows = s.execute(select(Doc).where(Doc.product_id == product.id).order_by(Doc.updated_at.desc()))
        return [doc_dict(d) for d in rows.scalars()]


def save_doc(product: Product, user: str, body: dict, number: int | None = None) -> dict:
    with session() as s:
        if number is None:
            title = str(body.get("title") or "").strip()
            if not title:
                raise CollabError(422, "タイトルを入れてください")
            d = Doc(product_id=product.id, number=_next(s, Doc, product.id), title=title, updated_by=user)
            s.add(d)
        else:
            d = s.execute(select(Doc).where(Doc.product_id == product.id, Doc.number == number)).scalar_one_or_none()
            if d is None:
                raise CollabError(404, f"DOC-{number} はありません")
        if body.get("title"):
            d.title = str(body["title"])[:300]
        if "body" in body and body["body"] is not None:
            d.body = str(body["body"])
        d.refs, d.updated_by = _refs(d.title, d.body), user
        s.commit()
        out = doc_dict(d, True)
    repo.log(product.id, None, "human", user, "doc.create" if number is None else "doc.update",
             {"doc": out["key"], "title": out["title"]})
    return out


def doc(product: Product, number: int) -> dict:
    with session() as s:
        d = s.execute(select(Doc).where(Doc.product_id == product.id, Doc.number == number)).scalar_one_or_none()
        if d is None:
            raise CollabError(404, f"DOC-{number} はありません")
        return doc_dict(d, True)


# ---------------- 通知 ----------------
def notices(tenant_id: str, user: str, limit: int = 50) -> dict:
    with session() as s:
        rows = list(s.execute(select(Notice).where(Notice.tenant_id == tenant_id, Notice.user == user)
                              .order_by(Notice.id.desc()).limit(limit)).scalars())
        unread = s.execute(select(func.count()).where(Notice.tenant_id == tenant_id, Notice.user == user,
                                                      Notice.read.is_(False))).scalar()
        return {"unread": unread, "items": [{"id": n.id, "kind": n.kind, "text": n.text, "link": n.link,
                                             "actor": n.actor, "read": n.read, "product_id": n.product_id,
                                             "created_at": _iso(n.created_at)} for n in rows]}


def read_notices(tenant_id: str, user: str) -> None:
    with session() as s:
        for n in s.execute(select(Notice).where(Notice.tenant_id == tenant_id, Notice.user == user,
                                                Notice.read.is_(False))).scalars():
            n.read = True
        s.commit()


# ---------------- ID から中身を引く ----------------
def lookup(product: Product, ref: str) -> dict | None:
    """DOC-4 の見出し。成果物の ID は web 側でステージへのリンクにする。"""
    m = re.fullmatch(r"DOC-(\d+)", ref)
    if not m:
        return None
    with session() as s:
        q = select(Doc).where(Doc.product_id == product.id, Doc.number == int(m.group(1)))
        row = s.execute(q).scalar_one_or_none()
        if row is None:
            return None
        return {"ref": ref, "kind": "doc", "title": row.title, "status": None}
