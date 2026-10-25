"""チーム（チケット・議論・決定記録・会議・ドキュメント・通知）の API。

読むのはプロダクトと同じテナントの人なら誰でも、書くのは MEMBER 以上。
"""
from __future__ import annotations

import os

from fastapi import APIRouter, Depends, Header, HTTPException
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


class TicketBody(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    body: str | None = Field(default=None, max_length=50_000)
    status: str | None = None
    priority: str | None = None
    assignee: str | None = Field(default=None, max_length=200)
    stage_id: str | None = Field(default=None, max_length=8)
    due: str | None = Field(default=None, max_length=10)
    refs: list[str] | None = None


class ChannelBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    topic: str = Field(default="", max_length=300)
    external: dict | None = None


class PostBody(BaseModel):
    body: str = Field(min_length=1, max_length=20_000)
    parent_id: int | None = None


class ImportItem(BaseModel):
    author: str = Field(default="", max_length=200)
    body: str = Field(max_length=20_000)
    at: str | None = Field(default=None, max_length=40)
    url: str | None = Field(default=None, max_length=500)


class ImportBody(BaseModel):
    items: list[ImportItem] = Field(max_length=500)


class DecisionBody(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    detail: str = Field(default="", max_length=20_000)
    rationale: str = Field(default="", max_length=20_000)
    stage_id: str | None = Field(default=None, max_length=8)
    refs: list[str] | None = None
    confirmed: bool = False


class DecideBody(BaseModel):
    status: str
    title: str | None = Field(default=None, max_length=300)
    detail: str | None = Field(default=None, max_length=20_000)
    rationale: str | None = Field(default=None, max_length=20_000)
    stage_id: str | None = Field(default=None, max_length=8)
    refs: list[str] | None = None
    create_ticket: bool = False


class MeetingBody(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    starts_at: str | None = Field(default=None, max_length=25)
    attendees: list[str] | None = None
    agenda: str | None = Field(default=None, max_length=50_000)
    transcript: str | None = Field(default=None, max_length=500_000)
    minutes: str | None = Field(default=None, max_length=100_000)
    source: dict | None = None


class DocBody(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    body: str | None = Field(default=None, max_length=500_000)


P = "/products/{product_id}"


# ---------------- チケット ----------------
@router.get(P + "/tickets")
def list_tickets(product_id: str, status: str | None = None, c: Caller = Depends(caller)):
    return collab.tickets(_p(c, product_id), status)


def _sync(p: Product, ticket: dict) -> dict:
    """同期の対象なら Issue に反映して、その結果をチケットに載せて返す。"""
    gh = ghsync.push_ticket(p, ticket["number"])
    if gh is not None:
        ticket = {**ticket, "external": {**(ticket.get("external") or {}), "github": gh}}
    return ticket


@router.post(P + "/tickets")
def post_ticket(product_id: str, body: TicketBody, c: Caller = Depends(caller)):
    p = _p(c, product_id, True)
    return _sync(p, collab.create_ticket(p, c.user, body.model_dump(exclude_none=True)))


@router.get(P + "/tickets/{number}")
def get_ticket(product_id: str, number: int, c: Caller = Depends(caller)):
    return collab.ticket(_p(c, product_id), number)


@router.patch(P + "/tickets/{number}")
def patch_ticket(product_id: str, number: int, body: TicketBody, c: Caller = Depends(caller)):
    p = _p(c, product_id, True)
    return _sync(p, collab.update_ticket(p, c.user, number, body.model_dump(exclude_unset=True)))


@router.post(P + "/tickets/{number}/comments")
def comment_ticket(product_id: str, number: int, body: PostBody, c: Caller = Depends(caller)):
    p = _p(c, product_id, True)
    post = collab.add_post(p, c.user, body.body, ticket_number=number)
    ghsync.push_comment(p, number, post["id"])
    return post


# ---------------- チャンネルと発言 ----------------
@router.get(P + "/channels")
def list_channels(product_id: str, c: Caller = Depends(caller)):
    return collab.channels(_p(c, product_id))


@router.post(P + "/channels")
def post_channel(product_id: str, body: ChannelBody, c: Caller = Depends(caller)):
    return collab.create_channel(_p(c, product_id, True), c.user, body.name, body.topic, body.external)


@router.get(P + "/channels/{channel_id}/posts")
def get_posts(product_id: str, channel_id: str, c: Caller = Depends(caller)):
    return collab.channel_posts(_p(c, product_id), channel_id)


@router.post(P + "/channels/{channel_id}/posts")
def post_post(product_id: str, channel_id: str, body: PostBody, c: Caller = Depends(caller)):
    return collab.add_post(_p(c, product_id, True), c.user, body.body, channel_id=channel_id, parent_id=body.parent_id)


@router.post(P + "/channels/{channel_id}/import")
def import_channel(product_id: str, channel_id: str, body: ImportBody, c: Caller = Depends(caller)):
    items = [i.model_dump() for i in body.items]
    return collab.import_posts(_p(c, product_id, True), c.user, channel_id, items)


@router.get(P + "/threads/{post_id}")
def get_thread(product_id: str, post_id: int, c: Caller = Depends(caller)):
    return collab.thread(_p(c, product_id), post_id)


@router.post(P + "/threads/{post_id}/extract")
def extract_thread(product_id: str, post_id: int, c: Caller = Depends(caller)):
    return collab.extract_thread(_p(c, product_id, True), c.user, post_id)


# ---------------- 決定記録 ----------------
@router.get(P + "/decisions")
def list_decisions(product_id: str, status: str | None = None, c: Caller = Depends(caller)):
    return collab.decisions(_p(c, product_id), status)


@router.post(P + "/decisions")
def post_decision(product_id: str, body: DecisionBody, c: Caller = Depends(caller)):
    return collab.create_decision(_p(c, product_id, True), c.user, body.model_dump())


@router.post(P + "/decisions/{number}/decide")
def decide(product_id: str, number: int, body: DecideBody, c: Caller = Depends(caller)):
    p = _p(c, product_id, True)
    out = collab.decide(p, c.user, number, body.model_dump(exclude_unset=True))
    if out.get("ticket"):
        out["ticket"] = _sync(p, out["ticket"])
    return out


# ---------------- 会議 ----------------
@router.get(P + "/meetings")
def list_meetings(product_id: str, c: Caller = Depends(caller)):
    return collab.meetings(_p(c, product_id))


@router.post(P + "/meetings")
def post_meeting(product_id: str, body: MeetingBody, c: Caller = Depends(caller)):
    return collab.save_meeting(_p(c, product_id, True), c.user, body.model_dump(exclude_none=True))


@router.get(P + "/meetings/{number}")
def get_meeting(product_id: str, number: int, c: Caller = Depends(caller)):
    return collab.meeting(_p(c, product_id), number)


@router.put(P + "/meetings/{number}")
def put_meeting(product_id: str, number: int, body: MeetingBody, c: Caller = Depends(caller)):
    collab.save_meeting(_p(c, product_id, True), c.user, body.model_dump(exclude_none=True), number)
    return collab.meeting(_p(c, product_id), number)


@router.post(P + "/meetings/{number}/minutes")
def minutes(product_id: str, number: int, c: Caller = Depends(caller)):
    return collab.make_minutes(_p(c, product_id, True), c.user, number)


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


# ---------------- GitHub Issues との同期 ----------------
class GithubConfig(BaseModel):
    sync: str
    import_new: bool = False


class TokenBody(BaseModel):
    token: str | None = Field(default=None, max_length=300)


class Webhook(BaseModel):
    event: str = Field(max_length=60)
    repo: str = Field(max_length=200)


@router.get(P + "/github")
def github_status(product_id: str, c: Caller = Depends(caller)):
    return ghsync.status(_p(c, product_id))


@router.put(P + "/github")
def github_configure(product_id: str, body: GithubConfig, c: Caller = Depends(caller)):
    p = _p(c, product_id, True)
    if c.base_role not in ("OWNER", "ADMIN"):
        raise HTTPException(403, "同期の設定は OWNER か ADMIN だけが変えられます")
    return ghsync.configure(p, c.user, body.sync, body.import_new)


@router.post(P + "/github/sync")
def github_pull(product_id: str, c: Caller = Depends(caller)):
    return ghsync.pull(_p(c, product_id, True), c.user)


@router.post(P + "/tickets/{number}/github")
def github_push(product_id: str, number: int, c: Caller = Depends(caller)):
    p = _p(c, product_id, True)
    collab.ticket(p, number)  # 無ければ 404
    gh = ghsync.push_ticket(p, number, force=True)
    return {"github": gh}


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


@router.post("/github/webhook")
def github_webhook(body: Webhook, x_pf_internal_token: str = Header(default="")):
    """web が署名を確かめたうえで中継する。該当するプロダクトを取り込み直す。"""
    if x_pf_internal_token != os.environ.get("PF_INTERNAL_TOKEN", "dev-internal-token"):
        raise HTTPException(401, "invalid internal token")
    done = []
    if body.event in ("issues", "issue_comment"):
        for p in ghsync.products_for_repo(body.repo):
            try:
                done.append({"product": p.id, **ghsync.pull(p, "github-webhook")})
            except ghsync.SyncError as e:
                done.append({"product": p.id, "error": e.message})
    return {"ok": True, "pulled": done}
