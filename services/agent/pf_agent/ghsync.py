"""チケットと GitHub Issues の同期。

- PF → GitHub：同期の対象（プロダクトの設定で ⑫⑬ のチケットだけ・すべて）か、手で起票したチケットは、
  作成・更新・コメントのたびに Issue に反映する。完了・閉じたは Issue を閉じ、戻せば開き直す。
- GitHub → PF：前回から更新された Issue を読み、閉じた・開き直した・題名の変更・新しいコメントを
  チケットに戻す。設定すれば、GitHub で作られた Issue を「仕分け待ち」のチケットとして取り込む。
- 往復で同じ変更を繰り返さないよう、PF が書いた本文とコメントには印（HTML コメント）を付け、
  Issue の updated_at を覚えて、それより新しい変更だけを取り込む。
"""
from __future__ import annotations

import datetime as dt
import os
import re

from sqlalchemy import select

from . import code, collab, repo, tenantsec
from .db import Post, Product, Ticket, session
from .stages import STAGE_BY_ID

SYNC_MODES = ("off", "build", "all")
BUILD_STAGES = ("s12", "s13")
TITLE_RE = re.compile(r"^\[TK-\d+\]\s*")
MARK_TICKET = "<!-- pf:ticket={pid}:{n} -->"
MARK_POST_RE = re.compile(r"<!-- pf:post=\d+ -->")
MAX_PAGES = 5


class SyncError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def token(tenant_id: str) -> tuple[str | None, str]:
    t = tenantsec.get(tenant_id, "github_token")
    if t:
        return t, "tenant"
    if os.environ.get("GITHUB_TOKEN"):
        return os.environ["GITHUB_TOKEN"], "server"
    return None, "none"


def _now() -> str:
    return dt.datetime.now(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def status(product: Product) -> dict:
    _, src = token(product.tenant_id)
    hint = tenantsec.hint(product.tenant_id, "github_token")
    return {"repo": product.repo, "sync": product.gh_sync or "off", "import": bool(product.gh_import),
            "synced_at": product.gh_synced_at, "token": {"source": src, "hint": hint}}


def configure(product: Product, user: str, sync: str, import_new: bool) -> dict:
    if sync not in SYNC_MODES:
        raise SyncError(422, f"同期は {list(SYNC_MODES)} のどれか")
    if sync != "off" and not product.repo:
        raise SyncError(409, "先に「コード（IDE）」で GitHub リポジトリをつないでください")
    with session() as s:
        p = s.get(Product, product.id)
        p.gh_sync, p.gh_import = sync, import_new
        if sync != "off" and not p.gh_synced_at:
            p.gh_synced_at = _now()   # つないだ時点より前の Issue は取り込まない
        s.commit()
        product = p
    repo.log(product.id, None, "human", user, "github.configure", {"sync": sync, "import": import_new})
    return status(product)


def _in_scope(product: Product, t: Ticket) -> bool:
    if (t.external or {}).get("github"):
        return True
    mode = product.gh_sync or "off"
    return mode == "all" or (mode == "build" and t.stage_id in BUILD_STAGES)


def _issue_body(product: Product, t: Ticket) -> str:
    web = os.environ.get("PF_WEB_URL", "").rstrip("/")
    link = f"[{f'TK-{t.number}'}]({web}/p/{product.id}/tickets/{t.number})" if web else f"TK-{t.number}"
    meta = [f"Product Factory: {link}", f"状態: {collab_status(t.status)}", f"優先度: {t.priority}"]
    if t.stage_id in STAGE_BY_ID:
        st = STAGE_BY_ID[t.stage_id]
        meta.append(f"ステージ: {st.no} {st.name}")
    if t.assignee:
        meta.append(f"担当: {t.assignee}")
    if t.due:
        meta.append(f"期日: {t.due}")
    if t.refs:
        meta.append("関係: " + ", ".join(t.refs))
    mark = MARK_TICKET.format(pid=product.id, n=t.number)
    return (t.body or "").rstrip() + "\n\n---\n" + " ・ ".join(meta) + "\n" + mark


def collab_status(s: str) -> str:
    return {"triage": "仕分け待ち", "todo": "未着手", "doing": "進行中", "review": "レビュー",
            "done": "完了", "closed": "閉じた"}.get(s, s)


def _payload(product: Product, t: Ticket) -> dict:
    body = {"title": f"[TK-{t.number}] {t.title}", "body": _issue_body(product, t)}
    if t.status in ("done", "closed"):
        body.update(state="closed", state_reason="completed" if t.status == "done" else "not_planned")
    else:
        body["state"] = "open"
    return body


def push_ticket(product: Product, number: int, force: bool = False) -> dict | None:
    """チケットを Issue に反映する。対象外なら何もしない。失敗はチケットに残して返す（呼び出し元は止めない）。"""
    if not product.repo:
        if force:
            raise SyncError(409, "先に「コード（IDE）」で GitHub リポジトリをつないでください")
        return None
    tok, _ = token(product.tenant_id)
    with session() as s:
        t = s.execute(select(Ticket).where(Ticket.product_id == product.id, Ticket.number == number)).scalar_one()
        if not (force or _in_scope(product, t)):
            return None
        ext = dict(t.external or {})
        gh = dict(ext.get("github") or {})
        try:
            if gh.get("number") and gh.get("repo") == product.repo:
                issue = code.call("PATCH", f"/repos/{product.repo}/issues/{gh['number']}", tok, _payload(product, t))
            else:
                body = _payload(product, t)
                state = body.pop("state")
                body.pop("state_reason", None)
                body["labels"] = ["product-factory", t.priority]
                issue = code.call("POST", f"/repos/{product.repo}/issues", tok, body)
                if state == "closed":
                    issue = code.call("PATCH", f"/repos/{product.repo}/issues/{issue['number']}", tok,
                                      _payload(product, t))
            gh = {"repo": product.repo, "number": issue["number"], "url": issue["html_url"], "state": issue["state"],
                  "synced_at": issue["updated_at"], "error": None}
        except code.CodeError as e:
            gh["error"] = e.message
            if force:
                ext["github"] = gh
                t.external = ext
                s.commit()
                raise SyncError(e.status, e.message) from None
        ext["github"] = gh
        t.external = ext
        s.commit()
        return gh


def push_comment(product: Product, number: int, post_id: int) -> None:
    with session() as s:
        t = s.execute(select(Ticket).where(Ticket.product_id == product.id, Ticket.number == number)).scalar_one()
        gh = (t.external or {}).get("github") or {}
        p = s.get(Post, post_id)
        if not gh.get("number") or p is None:
            return
        tok, _ = token(product.tenant_id)
        try:
            c = code.call("POST", f"/repos/{gh['repo']}/issues/{gh['number']}/comments", tok,
                          {"body": f"**{p.author}**（Product Factory）\n\n{p.body}\n\n<!-- pf:post={p.id} -->"})
            p.source = {**(p.source or {}), "provider": "github", "github_comment_id": c["id"], "url": c["html_url"],
                        "pushed": True}
        except code.CodeError as e:
            p.source = {**(p.source or {}), "github_error": e.message}
        s.commit()


def pull(product: Product, user: str = "github-sync") -> dict:
    """前回から更新された Issue とコメントを取り込む。"""
    if not product.repo or (product.gh_sync or "off") == "off":
        raise SyncError(409, "このプロダクトは GitHub と同期していません")
    tok, _ = token(product.tenant_id)
    started = _now()
    since = product.gh_synced_at
    issues: list[dict] = []
    try:
        for page in range(1, MAX_PAGES + 1):
            q = f"state=all&sort=updated&direction=asc&per_page=100&page={page}" + (f"&since={since}" if since else "")
            batch = code.call("GET", f"/repos/{product.repo}/issues?{q}", tok) or []
            issues += [i for i in batch if "pull_request" not in i]
            if len(batch) < 100:
                break
    except code.CodeError as e:
        raise SyncError(e.status, e.message) from None

    with session() as s:
        tickets = list(s.execute(select(Ticket).where(Ticket.product_id == product.id)).scalars())
    by_issue = {(t.external or {}).get("github", {}).get("number"): t for t in tickets
                if (t.external or {}).get("github", {}).get("repo") == product.repo}
    updated = created = comments = 0
    for issue in issues:
        t = by_issue.get(issue["number"])
        if t is None:
            # 別のプロダクトが作った Issue は取り込まない
            if "<!-- pf:ticket=" in (issue.get("body") or "") or not product.gh_import:
                continue
            out = collab.create_ticket(product, f"github:{issue['user']['login']}", {
                "title": issue["title"][:300], "body": (issue.get("body") or "")[:50_000],
                "status": "done" if issue["state"] == "closed" else "triage"},
                source={"kind": "github", "id": f"#{issue['number']}", "url": issue["html_url"]})
            with session() as s:
                nt = s.execute(select(Ticket).where(Ticket.product_id == product.id,
                                                    Ticket.number == out["number"])).scalar_one()
                nt.external = {"github": {"repo": product.repo, "number": issue["number"], "url": issue["html_url"],
                                          "state": issue["state"], "synced_at": issue["updated_at"], "error": None}}
                s.commit()
                t = nt
            created += 1
            comments += _pull_comments(product, t, issue, tok, since=None)
            continue
        gh = (t.external or {}).get("github", {})
        if issue["updated_at"] <= (gh.get("synced_at") or ""):
            continue
        with session() as s:
            row = s.get(Ticket, t.id)
            changed = {}
            title = TITLE_RE.sub("", issue["title"]).strip()
            if title and title != row.title:
                row.title, changed["title"] = title[:300], title
            if issue["state"] == "closed" and row.status not in ("done", "closed"):
                row.status = "done" if issue.get("state_reason") != "not_planned" else "closed"
                changed["status"] = row.status
            elif issue["state"] == "open" and row.status in ("done", "closed"):
                row.status, changed["status"] = "todo", "todo"
            row.external = {**(row.external or {}), "github": {**gh, "state": issue["state"],
                                                               "synced_at": issue["updated_at"], "error": None}}
            s.commit()
        if changed:
            updated += 1
            repo.log(product.id, t.stage_id, "system", user, "ticket.github",
                     {"ticket": f"TK-{t.number}", "issue": issue["number"], **changed})
        comments += _pull_comments(product, t, issue, tok, since=gh.get("synced_at"))

    with session() as s:
        s.get(Product, product.id).gh_synced_at = started
        s.commit()
    return {"issues": len(issues), "updated": updated, "created": created, "comments": comments, "synced_at": started}


def _pull_comments(product: Product, t: Ticket, issue: dict, tok: str | None, since: str | None) -> int:
    if not issue.get("comments"):
        return 0
    q = "per_page=100" + (f"&since={since}" if since else "")
    try:
        items = code.call("GET", f"/repos/{product.repo}/issues/{issue['number']}/comments?{q}", tok) or []
    except code.CodeError:
        return 0
    with session() as s:
        known = {(p.source or {}).get("github_comment_id") for p in
                 s.execute(select(Post).where(Post.ticket_id == t.id)).scalars()}
        n = 0
        for c in items:
            if c["id"] in known or MARK_POST_RE.search(c.get("body") or ""):
                continue
            s.add(Post(product_id=product.id, ticket_id=t.id, author=f"github:{c['user']['login']}",
                       body=c.get("body") or "", refs=collab._refs(c.get("body") or ""), mentions=[],
                       source={"provider": "github", "github_comment_id": c["id"], "url": c["html_url"]}))
            n += 1
        s.commit()
    return n


def products_for_repo(full_name: str) -> list[Product]:
    with session() as s:
        return list(s.execute(select(Product).where(Product.repo == full_name, Product.gh_sync != "off")).scalars())
