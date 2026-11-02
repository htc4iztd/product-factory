"""参照の登録簿：AI が根拠として引用できる ID（`種類:キー`）を、種類ごとに DB（と GitHub）から解決する。

| 種類 | 例 | 返す状態 |
|---|---|---|
| job | job:3f9a… | kind・status（queued・running・done・failed・cancelled） |
| issue | issue:#12 | status・assignee・stage_id |
| note | note:45 | pm・kind |
| report | report:s07 | 担当の報告（progress・health） |
| post | post:1352 | sender・recipient・intent |
| stage | stage:s09 | status（completed など）・approved_version・current_version |
| field | field:s07.flows | 中身があるか（filled） |
| msg | msg:88 | チャットの発言。PdM の判断（承認依頼に答えたもの：approved・rejected と答えた人） |
| review | review:c1r2 | プロダクトレビューの回の status（reviewing・ready・fixing・fixed）と完了したか |
| pr | pr:#7 | プロダクトのリポジトリのプルリクエスト（merged・state）。GitHub に聞く |

解決できない（形が違う・実在しない・ほかのプロダクトのもの）なら None。新しい種類はここに足す。
"""
from __future__ import annotations

import re

from sqlalchemy import select

from . import frameworks as fx
from . import fwlib, repo
from .db import AgentIssue, AssistantMessage, BoardPost, JobRun, PmNote, Product, ProductCycle, TeamAgent, session
from .stages import STAGE_BY_ID

PATTERN = re.compile(
    r"^(job:[0-9a-f]{6,64}|issue:#?\d+|note:\d+|report:[a-z0-9_]+|post:\d+|stage:s\d\d|field:s\d\d\.[A-Za-z0-9_.-]+"
    r"|msg:\d+|review:c\d+r\d+|pr:#?\d+)$"
)
# 文章の中の [種類:キー] を拾う（材料に付けた ID を、引用してよい ID として集めるため）
IN_TEXT = re.compile(
    r"\[((?:job:[0-9a-f]{6,64})|(?:issue:#\d+)|(?:note:\d+)|(?:report:[a-z0-9_]+)|(?:post:\d+)|(?:stage:s\d\d)"
    r"|(?:field:s\d\d\.[A-Za-z0-9_.-]+)|(?:msg:\d+)|(?:review:c\d+r\d+)|(?:pr:#\d+))\]"
)


def cited(text: str) -> set[str]:
    return set(IN_TEXT.findall(text or ""))


def normalize(ref: str) -> str | None:
    r = (ref or "").strip().strip("[]").strip()
    return r if PATTERN.match(r) else None


def resolve(product_id: str, ref: str) -> dict | None:
    """ID を解決して状態を返す。返り値には必ず kind（種類）が入る。"""
    r = normalize(ref)
    if r is None:
        return None
    kind, key = r.split(":", 1)
    fn = _RESOLVERS.get(kind)
    return {"kind": kind, "ref": r, **out} if fn and (out := fn(product_id, key)) is not None else None


def _job(pid: str, key: str) -> dict | None:
    with session() as s:
        j = s.get(JobRun, key)
        return {"job_kind": j.kind, "status": j.status} if j is not None and j.product_id == pid else None


def _issue(pid: str, key: str) -> dict | None:
    with session() as s:
        i = s.execute(
            select(AgentIssue).where(AgentIssue.product_id == pid, AgentIssue.number == int(key.lstrip("#")))
        ).scalar_one_or_none()
        return {"status": i.status, "assignee": i.assignee, "stage_id": i.stage_id} if i else None


def _note(pid: str, key: str) -> dict | None:
    with session() as s:
        n = s.get(PmNote, int(key))
        return {"pm": n.pm, "note_kind": n.kind} if n is not None and n.product_id == pid else None


def _report(pid: str, key: str) -> dict | None:
    with session() as s:
        a = s.execute(select(TeamAgent).where(TeamAgent.product_id == pid, TeamAgent.key == key)).scalar_one_or_none()
        return {"progress": (a.report or {}).get("progress"), "health": (a.report or {}).get("health")} if a else None


def _post(pid: str, key: str) -> dict | None:
    with session() as s:
        p = s.get(BoardPost, int(key))
        if p is None or p.product_id != pid:
            return None
        return {"sender": p.sender, "recipient": p.recipient, "intent": p.intent}


def _stage(pid: str, key: str) -> dict | None:
    if key not in STAGE_BY_ID:
        return None
    r = repo.runs(pid).get(key)
    if r is None:
        return None
    return {"status": r.status, "approved_version": r.approved_version or 0, "current_version": r.current_version or 0,
            "enabled": r.enabled}


def _field(pid: str, key: str) -> dict | None:
    sid, _, fk = key.partition(".")
    if sid not in STAGE_BY_ID:
        return None
    f = fwlib.of(pid, sid).get(fk)
    if f is None:
        return None
    return {"stage_id": sid, "filled": bool(fx.is_filled(f, repo.draft(pid, sid).get(f.key)))}


def _msg(pid: str, key: str) -> dict | None:
    with session() as s:
        m = s.get(AssistantMessage, int(key))
        if m is None or m.product_id != pid:
            return None
        decided = [{"status": a.get("status"), "decided_by": a.get("decided_by"), "type": a.get("type")}
                   for a in m.actions or [] if a.get("status") in ("approved", "rejected")]
        return {"role": m.role, "agent": m.agent, "decisions": decided}


def _review(pid: str, key: str) -> dict | None:
    m = re.fullmatch(r"c(\d+)r(\d+)", key)
    if not m:
        return None
    with session() as s:
        c = s.execute(
            select(ProductCycle).where(ProductCycle.product_id == pid, ProductCycle.number == int(m.group(1)))
        ).scalar_one_or_none()
        if c is None:
            return None
        rv = c.review or {}
        rnd = next((r for r in rv.get("rounds", []) if r.get("n") == int(m.group(2))), None)
        if rnd is None:
            return None
        return {"status": rnd.get("status"), "completed": bool(rv.get("done_at"))}


def _pr(pid: str, key: str) -> dict | None:
    from . import code, ghsync

    with session() as s:
        p = s.get(Product, pid)
        repo_name, tenant = (p.repo, p.tenant_id) if p else (None, None)
    if not repo_name:
        return None
    tok, _ = ghsync.token(tenant)
    try:
        pr = code.call("GET", f"/repos/{repo_name}/pulls/{int(key.lstrip('#'))}", tok)
    except code.CodeError:
        return None
    return {"merged": bool((pr or {}).get("merged")), "state": (pr or {}).get("state")} if pr else None


_RESOLVERS = {"job": _job, "issue": _issue, "note": _note, "report": _report, "post": _post, "stage": _stage,
              "field": _field, "msg": _msg, "review": _review, "pr": _pr}
