"""エージェントの Issue（#n）：Redmine と同じ形
（トラッカー・状態・優先度・担当・起票者・開始日・期日・進捗率・親・記録）。

- 担当（宛先）にできるのは PM（pm_biz・pm_design・pm_impl）と各工程の担当（s01〜s14）だけ。PdM は宛先にできない
- PdM が起票できるのは PM 宛てだけ（PdM が話せるのは PM だけ）。PdM が書き込めるのも PM が担当の Issue だけ
- 起票・担当の付け替えをすると、担当にすぐリクエストが飛ぶ（担当が動く）。担当は10分ごとの確認でも拾う
- 更新するたびに記録（IssueJournal）を残す：注記と、変えた属性の前後
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import func, select

from .db import AgentIssue, IssueJournal, Product, session
from .stages import STAGE_BY_ID

TRACKERS = {"task": "タスク", "feature": "機能", "bug": "バグ", "question": "質問", "support": "サポート"}
STATUSES = {
    "new": "新規",
    "in_progress": "進行中",
    "resolved": "解決",
    "feedback": "フィードバック",
    "closed": "終了",
    "rejected": "却下",
}
PRIORITIES = {"low": "低め", "normal": "通常", "high": "高め", "urgent": "急いで", "immediate": "今すぐ"}
PROPS = {
    "status": "状態",
    "assignee": "担当",
    "priority": "優先度",
    "done_ratio": "進捗率",
    "due_date": "期日",
    "start_date": "開始日",
    "tracker": "トラッカー",
    "subject": "題名",
    "parent": "親チケット",
}


class IssueError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def _keys() -> tuple[str, ...]:
    from .team import KEYS

    return KEYS


def _pms() -> tuple[str, ...]:
    from .team import PMS

    return PMS


def _name(key: str) -> str:
    from .team import name_of

    if key == "github":
        return "GitHub"
    if key.startswith("github:"):
        return f"GitHub @{key[7:]}"
    return name_of(key) if key in _keys() else "PdM"


def _show(prop: str, v):
    """記録の前後の値を読める形に（担当は名前、状態・優先度は日本語）。"""
    if prop == "assignee" and v:
        return _name(v)
    if prop == "status":
        return STATUSES.get(v, v)
    if prop == "priority":
        return PRIORITIES.get(v, v)
    if prop == "done_ratio" and v is not None:
        return f"{v}%"
    return v


def issue_dict(i: AgentIssue, journals: list[IssueJournal] | None = None) -> dict:
    d = {
        "number": i.number,
        "key": f"#{i.number}",
        "tracker": i.tracker,
        "tracker_label": TRACKERS.get(i.tracker, i.tracker),
        "subject": i.subject,
        "description": i.description,
        "status": i.status,
        "status_label": STATUSES.get(i.status, i.status),
        "priority": i.priority,
        "priority_label": PRIORITIES.get(i.priority, i.priority),
        "author": i.author,
        "author_name": _name(i.author),
        "assignee": i.assignee,
        "assignee_name": _name(i.assignee),
        "watchers": i.watchers or [],
        "stage_id": i.stage_id,
        "parent": i.parent,
        "start_date": i.start_date,
        "due_date": i.due_date,
        "done_ratio": i.done_ratio,
        "github": {k: (i.github or {}).get(k) for k in ("repo", "number", "url", "state", "synced_at", "error")}
        if i.github
        else None,
        "created_at": i.created_at.isoformat(),
        "updated_at": i.updated_at.isoformat(),
    }
    if journals is not None:
        d["journals"] = [
            {
                "id": j.id,
                "author": j.author,
                "author_name": _name(j.author),
                "notes": j.notes,
                "details": [{**x, "label": PROPS.get(x["prop"], x["prop"])} for x in j.details or []],
                "created_at": j.created_at.isoformat(),
            }
            for j in journals
        ]
    return d


def _check_assignee(key: str, by_pdm: bool) -> None:
    if key == "pdm" or key not in _keys():
        raise IssueError(422, "宛先にできるのは PM と各工程の担当だけです（PdM は宛先にできません）")
    if by_pdm and key not in _pms():
        raise IssueError(403, "PdM が起票できるのは PM 宛てだけです")


def create(
    product: Product,
    author: str,
    assignee: str,
    subject: str,
    description: str = "",
    *,
    tracker: str = "task",
    priority: str = "normal",
    stage_id: str | None = None,
    parent: int | None = None,
    start_date: str | None = None,
    due_date: str | None = None,
    watchers: list[str] | None = None,
    wake: bool = True,
) -> dict:
    by_pdm = author not in _keys()
    _check_assignee(assignee, by_pdm)
    if not subject.strip():
        raise IssueError(422, "題名が空です")
    if author == assignee:
        raise IssueError(422, "自分宛ての Issue は起票できません")
    with session() as s:
        n = (
            s.execute(select(func.max(AgentIssue.number)).where(AgentIssue.product_id == product.id)).scalar() or 0
        ) + 1
        i = AgentIssue(
            tenant_id=product.tenant_id,
            product_id=product.id,
            number=n,
            tracker=tracker if tracker in TRACKERS else "task",
            subject=subject.strip()[:300],
            description=description[:8000],
            priority=priority if priority in PRIORITIES else "normal",
            author=author[:200],
            assignee=assignee,
            watchers=[w for w in watchers or [] if w in _keys()] or None,
            stage_id=stage_id if stage_id in STAGE_BY_ID else None,
            parent=parent,
            start_date=start_date or dt.date.today().isoformat(),
            due_date=due_date,
        )
        s.add(i)
        s.commit()
        out = issue_dict(i, [])
    if wake:
        _wake(product, author, assignee, f"Issue #{out['number']}")
    return out


def _wake(product: Product, actor: str, key: str, reason: str) -> None:
    """担当にリクエストを飛ばす（すぐ動く）。"""
    from . import team

    try:
        team.start(product, actor if actor not in _keys() else product.created_by, [key], reason=reason)
    except Exception:  # noqa: BLE001, S110  起動できなくても、担当は10分ごとの確認で拾う
        pass


def _get(s, product: Product, number: int) -> AgentIssue:
    i = s.execute(
        select(AgentIssue).where(AgentIssue.product_id == product.id, AgentIssue.number == number)
    ).scalar_one_or_none()
    if i is None:
        raise IssueError(404, f"#{number} はありません")
    return i


def update(
    product: Product,
    actor: str,
    number: int,
    *,
    notes: str = "",
    status: str | None = None,
    assignee: str | None = None,
    priority: str | None = None,
    done_ratio: int | None = None,
    due_date: str | None = None,
    subject: str | None = None,
    wake: bool = True,
) -> dict:
    by_pdm = actor not in _keys()
    with session() as s:
        i = _get(s, product, number)
        if by_pdm and i.assignee not in _pms():
            raise IssueError(403, "PdM が書き込めるのは PM が担当の Issue だけです（担当とは PM を通して話します）")
        details = []

        def change(prop: str, new) -> None:
            old = getattr(i, prop)
            if new is not None and new != old:
                details.append({"prop": prop, "old": old, "new": new})
                setattr(i, prop, new)

        if status is not None:
            if status not in STATUSES:
                raise IssueError(422, f"状態は {list(STATUSES)} のどれか")
            change("status", status)
        if assignee:
            _check_assignee(assignee, by_pdm)
            change("assignee", assignee)
        if priority is not None and priority in PRIORITIES:
            change("priority", priority)
        if done_ratio is not None:
            change("done_ratio", max(0, min(100, int(done_ratio)) // 10 * 10))
        if due_date is not None:
            change("due_date", due_date or None)
        if subject is not None and subject.strip():
            change("subject", subject.strip()[:300])
        if not details and not notes.strip():
            return issue_dict(i, list(s.execute(select(IssueJournal).where(IssueJournal.issue_id == i.id)).scalars()))
        s.add(IssueJournal(issue_id=i.id, author=actor[:200], notes=notes.strip()[:8000], details=details or None))
        i.updated_at = dt.datetime.now(dt.UTC)
        s.commit()
        new_assignee = i.assignee
        reassigned = any(d["prop"] == "assignee" for d in details)
        journals = list(
            s.execute(select(IssueJournal).where(IssueJournal.issue_id == i.id).order_by(IssueJournal.id)).scalars()
        )
        out = issue_dict(i, journals)
    # 担当が替わった、または担当以外が書き足した（返事をした）ら、担当にリクエストを飛ばす
    if wake and (reassigned or actor != new_assignee) and out["status"] not in ("closed", "rejected"):
        _wake(product, actor, new_assignee, f"Issue #{number} の更新")
    return out


def get(product: Product, number: int) -> dict:
    with session() as s:
        i = _get(s, product, number)
        return issue_dict(
            i,
            list(
                s.execute(select(IssueJournal).where(IssueJournal.issue_id == i.id).order_by(IssueJournal.id)).scalars()
            ),
        )


def search(
    product: Product,
    assignee: str | None = None,
    author: str | None = None,
    status: str | None = None,
    open_only: bool = False,
    stage: str | None = None,
) -> list[dict]:
    with session() as s:
        q = select(AgentIssue).where(AgentIssue.product_id == product.id)
        if assignee:
            q = q.where(AgentIssue.assignee == assignee)
        if author:
            q = q.where(AgentIssue.author == author)
        if status:
            q = q.where(AgentIssue.status == status)
        if open_only:
            q = q.where(AgentIssue.status.not_in(("closed", "rejected")))
        if stage:
            q = q.where(AgentIssue.stage_id == stage)
        return [issue_dict(i) for i in s.execute(q.order_by(AgentIssue.number.desc()).limit(500)).scalars()]
