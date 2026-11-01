"""ドキュメント・通知・GitHub の接続設定の API。

読むのはプロダクトと同じテナントの人なら誰でも、書くのは MEMBER 以上。
チケット・議論・決定記録・会議の API は廃止した（Issue・振り返りの会議・ドキュメントに一本化）。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import collab, ghsync, tenantsec
from .authz import BASE_ORDER, Caller, caller
from .db import Product, session

router = APIRouter()


def _p(c: Caller, product_id: str, write: bool = False) -> Product:
    with session() as s:
        p = s.get(Product, product_id)
    if p is None or p.tenant_id != c.tenant:
        raise HTTPException(404, "product not found")
    if write and BASE_ORDER[c.base_role] < BASE_ORDER["MEMBER"]:
        raise HTTPException(403, "閲覧のみの権限では書き込めません")
    return p


class DocBody(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    body: str | None = Field(default=None, max_length=500_000)


class TokenBody(BaseModel):
    token: str | None = Field(default=None, max_length=300)


P = "/products/{product_id}"


# ---------------- ドキュメント ----------------
@router.get(P + "/docs")
def list_docs(product_id: str, c: Caller = Depends(caller)):
    return collab.docs(_p(c, product_id))


@router.post(P + "/docs")
def post_doc(product_id: str, body: DocBody, c: Caller = Depends(caller)):
    return collab.save_doc(_p(c, product_id, True), c.user, body.model_dump(exclude_none=True))


@router.get(P + "/docs/{number}")
def get_doc(product_id: str, number: int, c: Caller = Depends(caller)):
    return collab.doc(_p(c, product_id), number)


@router.put(P + "/docs/{number}")
def put_doc(product_id: str, number: int, body: DocBody, c: Caller = Depends(caller)):
    return collab.save_doc(_p(c, product_id, True), c.user, body.model_dump(exclude_none=True), number)


@router.get(P + "/refs/{ref}")
def lookup(product_id: str, ref: str, c: Caller = Depends(caller)):
    found = collab.lookup(_p(c, product_id), ref)
    if found is None:
        raise HTTPException(404, f"{ref} はありません")
    return found


# ---------------- 通知 ----------------
@router.get("/notices")
def get_notices(c: Caller = Depends(caller)):
    return collab.notices(c.tenant, c.user)


@router.post("/notices/read")
def read_notices(c: Caller = Depends(caller)):
    collab.read_notices(c.tenant, c.user)
    return {"ok": True}


# ---------------- GitHub の接続（コード・自動開発が使う） ----------------
@router.get("/settings/github")
def github_token_status(c: Caller = Depends(caller)):
    _, src = ghsync.token(c.tenant)
    return {"source": src, "hint": tenantsec.hint(c.tenant, "github_token"), "can_edit": c.base_role == "OWNER"}


@router.put("/settings/github")
def github_token(body: TokenBody, c: Caller = Depends(caller)):
    if c.base_role != "OWNER":
        raise HTTPException(403, "トークンはテナントの OWNER だけが変えられます")
    tenantsec.put(c.tenant, "github_token", (body.token or "").strip() or None, c.user)
    return github_token_status(c)


@router.post("/settings/github/test")
def github_test(c: Caller = Depends(caller)):
    tok, src = ghsync.token(c.tenant)
    if not tok:
        return {"ok": False, "error": "トークンがありません"}
    try:
        me = ghsync.code.call("GET", "/user", tok)
    except ghsync.code.CodeError as e:
        return {"ok": False, "error": e.message, "source": src}
    return {"ok": True, "login": me.get("login"), "source": src}
