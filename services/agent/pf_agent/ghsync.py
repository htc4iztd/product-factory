"""GitHub の接続（テナントのトークン）と、エージェントの Issue の GitHub Issues への同期。

同期は人が押したときだけ動く（自動では送らない・取りに行かない）：
- Issue ごとの「GitHub と同期」：まだなら GitHub に Issue を作る。つないであれば、GitHub 側の開閉・コメントを取り込み、
  こちらの題名・本文・状態・まだ送っていない記録（注記と属性の変更）を送る
- 「つないだ Issue をまとめて同期」：つないである Issue（と、選べば開いている Issue すべて）に同じことをする
開閉は、前回の同期から GitHub 側で変わっていれば GitHub を、そうでなければこちらを正とする。
"""
from __future__ import annotations

import datetime as dt
import os

from sqlalchemy import select

from . import code, tenantsec
from .db import AgentIssue, IssueJournal, Product, session

__all__ = ["code", "token", "SyncError", "status", "sync_issue", "sync_many"]

CLOSED = ("closed", "rejected")
SEEN_MAX = 500


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
    with session() as s:
        rows = list(s.execute(select(AgentIssue).where(AgentIssue.product_id == product.id)).scalars())
    linked = [i for i in rows if (i.github or {}).get("repo") == product.repo and product.repo]
    last = max((i.github["synced_at"] for i in linked if i.github.get("synced_at")), default=None)
    return {"repo": product.repo, "token": src, "linked": len(linked),
            "open_unlinked": sum(1 for i in rows if i not in linked and i.status not in CLOSED),
            "synced_at": last}


def _need(product: Product) -> str:
    if not product.repo:
        raise SyncError(409, "先に「コード」で GitHub リポジトリをつないでください")
    tok, _ = token(product.tenant_id)
    if not tok:
        raise SyncError(409, "GitHub のトークンがありません（設定 → GitHub で入れてください）")
    return tok


def _body(product: Product, i: AgentIssue) -> str:
    from .issues import PRIORITIES, STATUSES, TRACKERS, _name

    web = os.environ.get("PF_WEB_URL", "").rstrip("/")
    ref = f"[#{i.number}]({web}/p/{product.id}/issues/{i.number})" if web else f"#{i.number}"
    meta = [f"Product Factory の Issue {ref}", f"トラッカー：{TRACKERS.get(i.tracker, i.tracker)}",
            f"状態：{STATUSES.get(i.status, i.status)}", f"優先度：{PRIORITIES.get(i.priority, i.priority)}",
            f"起票：{_name(i.author)}", f"担当：{_name(i.assignee)}", f"進捗：{i.done_ratio}%"]
    if i.due_date:
        meta.append(f"期日：{i.due_date}")
    return (i.description or "").rstrip() + "\n\n---\n" + " ・ ".join(meta)


def _comment(j: IssueJournal) -> str:
    from .issues import PROPS, _name, _show

    lines = [f"**{_name(j.author)}**"]
    for d in j.details or []:
        lines.append(f"- {PROPS.get(d['prop'], d['prop'])}：{_show(d['prop'], d['old']) or '（なし）'}"
                     f" → {_show(d['prop'], d['new']) or '（なし）'}")
    if j.notes:
        if j.details:
            lines.append("")
        lines.append(j.notes)
    return "\n".join(lines).strip()


def sync_issue(product: Product, user: str, number: int) -> dict:
    """1件を同期する。GitHub の失敗は SyncError にして返す（記録にも残す）。"""
    tok = _need(product)
    try:
        return _sync(product, user, number, tok)
    except code.CodeError as e:
        with session() as s:
            i = s.execute(select(AgentIssue).where(AgentIssue.product_id == product.id,
                                                   AgentIssue.number == number)).scalar_one_or_none()
            if i is not None and i.github:
                i.github = {**i.github, "error": e.message}
                s.commit()
        raise SyncError(e.status, e.message) from None


def _sync(product: Product, user: str, number: int, tok: str) -> dict:
    from .issues import IssueError, _get, _wake

    repo = product.repo
    out = {"number": number, "created": False, "pulled": 0, "pushed": 0, "state_from": None}
    with session() as s:
        try:
            i = _get(s, product, number)
        except IssueError as e:
            raise SyncError(e.status, e.message) from None
        gh = dict(i.github or {})
        if gh.get("repo") != repo or not gh.get("number"):
            made = code.call("POST", f"/repos/{repo}/issues", tok,
                             {"title": f"[PF #{i.number}] {i.subject}", "body": _body(product, i)})
            gh = {"repo": repo, "number": made["number"], "url": made["html_url"], "state": "open",
                  "pushed": 0, "seen": []}
            remote = made
            out["created"] = True
        else:
            remote = code.call("GET", f"/repos/{repo}/issues/{gh['number']}", tok)
        seen = set(gh.get("seen") or [])
        # 1) GitHub 側の変化を取り込む：開閉（前回から変わっていれば）とコメント（まだ見ていないもの）
        if not out["created"] and remote["state"] != gh.get("state"):
            old = i.status
            if remote["state"] == "closed" and i.status not in CLOSED:
                i.status = "rejected" if remote.get("state_reason") == "not_planned" else "closed"
            elif remote["state"] == "open" and i.status in CLOSED:
                i.status = "in_progress"
            if i.status != old:
                what = "閉じられました" if remote["state"] == "closed" else "開き直されました"
                s.add(IssueJournal(issue_id=i.id, author="github", notes=f"GitHub で{what}",
                                   details=[{"prop": "status", "old": old, "new": i.status}]))
                out["state_from"] = "github"
        if not out["created"] and remote.get("comments", 1):
            for c in code.call("GET", f"/repos/{repo}/issues/{gh['number']}/comments?per_page=100", tok) or []:
                if c["id"] in seen:
                    continue
                seen.add(c["id"])
                login = (c.get("user") or {}).get("login") or "someone"
                s.add(IssueJournal(issue_id=i.id, author=f"github:{login}"[:200], notes=(c.get("body") or "")[:8000]))
                out["pulled"] += 1
        s.flush()
        # 2) こちらの内容を送る：題名・本文・状態と、まだ送っていない記録（GitHub から来たものは除く）
        patch = {"title": f"[PF #{i.number}] {i.subject}", "body": _body(product, i)}
        want = "closed" if i.status in CLOSED else "open"
        if want != remote["state"]:
            patch["state"] = want
            if want == "closed":
                patch["state_reason"] = "not_planned" if i.status == "rejected" else "completed"
        if not out["created"] or want == "closed":
            remote = code.call("PATCH", f"/repos/{repo}/issues/{gh['number']}", tok, patch)
        js = s.execute(select(IssueJournal).where(IssueJournal.issue_id == i.id, IssueJournal.id > gh.get("pushed", 0))
                       .order_by(IssueJournal.id)).scalars()
        for j in list(js):
            gh["pushed"] = j.id
            if j.author.startswith("github") or not (j.notes or j.details):
                continue
            c = code.call("POST", f"/repos/{repo}/issues/{gh['number']}/comments", tok, {"body": _comment(j)})
            seen.add(c["id"])
            out["pushed"] += 1
        gh.update(state=remote["state"], url=remote.get("html_url", gh.get("url")), synced_at=_now(), error=None,
                  seen=sorted(seen)[-SEEN_MAX:], by=user[:200])
        i.github = gh
        if out["pulled"] or out["state_from"]:
            i.updated_at = dt.datetime.now(dt.UTC)
        s.commit()
        assignee, open_now = i.assignee, i.status not in CLOSED
    out.update(url=gh["url"], github_number=gh["number"])
    # GitHub で誰かが書いたら、担当に知らせて動かす
    if out["pulled"] and open_now:
        _wake(product, user, assignee, f"Issue #{number} に GitHub でコメント")
    return out


def sync_many(product: Product, user: str, numbers: list[int] | None = None, include_open: bool = False) -> dict:
    """つないである Issue（と、指定した番号・選べば開いている Issue すべて）を同期する。1件の失敗で止めない。"""
    tok = _need(product)
    with session() as s:
        rows = list(s.execute(select(AgentIssue).where(AgentIssue.product_id == product.id)
                              .order_by(AgentIssue.number)).scalars())
    want = [i.number for i in rows
            if ((i.github or {}).get("repo") == product.repo) or (numbers and i.number in numbers)
            or (include_open and i.status not in CLOSED)]
    done, errors = [], []
    for n in want:
        try:
            done.append(_sync(product, user, n, tok))
        except code.CodeError as e:
            errors.append({"number": n, "error": e.message})
    return {"done": done, "errors": errors, **status(product)}
