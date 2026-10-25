"""工場DBへの読み書き。ワークフローのノードとエンジンの両方から使う。"""
from __future__ import annotations

import copy
import hashlib

from sqlalchemy import select

from . import audit as audit_mod
from . import frameworks as fx
from .db import Artifact, AuditLog, ChatMessage, PhaseReview, Product, StageRun, session
from .stages import (
    AWAITING_APPROVAL,
    COMPLETED,
    IN_PROGRESS,
    NEEDS_RECHECK,
    NOT_STARTED,
    PHASES,
    REVISING,
    STAGE_BY_ID,
    STAGES,
    downstream_of,
)


def log(product_id: str | None, stage_id: str | None, actor_type: str, actor: str,
        kind: str, body: dict | None = None, version: int | None = None,
        reason: str | None = None, tenant_id: str | None = None) -> None:
    with session() as s:
        if tenant_id is None and product_id:
            tenant_id = s.get(Product, product_id).tenant_id
        s.add(AuditLog(tenant_id=tenant_id or "-", product_id=product_id, stage_id=stage_id,
                       actor_type=actor_type, actor=actor, kind=kind, body=body,
                       target_version=version, reason=reason))
        s.commit()


def _run(s, product_id: str, stage_id: str) -> StageRun:
    return s.execute(select(StageRun).where(StageRun.product_id == product_id,
                                            StageRun.stage_id == stage_id)).scalar_one()


def get_run(product_id: str, stage_id: str) -> StageRun:
    with session() as s:
        return _run(s, product_id, stage_id)


def runs(product_id: str) -> dict[str, StageRun]:
    with session() as s:
        return {r.stage_id: r for r in s.execute(
            select(StageRun).where(StageRun.product_id == product_id)).scalars()}


def set_status(product_id: str, stage_id: str, status: str) -> None:
    with session() as s:
        r = _run(s, product_id, stage_id)
        old = r.status
        r.status = status
        s.commit()
    if old != status:
        log(product_id, stage_id, "system", "factory", "status", body={"from": old, "to": status})


def set_session(product_id: str, stage_id: str, session_id: str) -> None:
    with session() as s:
        _run(s, product_id, stage_id).session_id = session_id
        s.commit()


def _artifact(s, product_id: str, stage_id: str, version: int) -> Artifact | None:
    if not version:
        return None
    return s.execute(select(Artifact).where(
        Artifact.product_id == product_id, Artifact.stage_id == stage_id,
        Artifact.version == version)).scalar_one_or_none()


def current_artifact(product_id: str, stage_id: str) -> Artifact | None:
    with session() as s:
        return _artifact(s, product_id, stage_id, _run(s, product_id, stage_id).current_version)


def confirmed_artifact(product_id: str, stage_id: str) -> Artifact | None:
    with session() as s:
        return _artifact(s, product_id, stage_id, _run(s, product_id, stage_id).approved_version)


def versions(product_id: str, stage_id: str) -> list[dict]:
    with session() as s:
        rows = s.execute(select(Artifact).where(Artifact.product_id == product_id, Artifact.stage_id == stage_id)
                         .order_by(Artifact.version.desc())).scalars()
        return [{"version": a.version, "confirmed": a.approved, "sha256": a.sha256,
                 "created_at": a.created_at.isoformat()} for a in rows]


def confirmed_artifacts(product_id: str, stage_ids) -> dict[str, str]:
    """上流として使う、使用中ステージの確定版（Markdown）。"""
    out = {}
    with session() as s:
        for sid in stage_ids:
            r = _run(s, product_id, sid)
            a = _artifact(s, product_id, sid, r.approved_version) if r.enabled else None
            if a is not None:
                out[f"{STAGE_BY_ID[sid].no} {STAGE_BY_ID[sid].name}"] = a.content
    return out


# ---------------- 下書き ----------------
def _initial_draft(s, r: StageRun) -> dict:
    fw = fx.FRAMEWORK_BY_STAGE[r.stage_id]
    draft = fx.empty_draft(fw)
    a = _artifact(s, r.product_id, r.stage_id, r.current_version)
    if a is not None and a.data:
        draft.update(copy.deepcopy(a.data))
    elif a is not None:
        # 文章だけで作っていた頃の版：見出しが項目名と一致する文章を引き継ぐ
        secs = audit_mod.sections(a.content)
        for f in fw.fields:
            if f.kind == "text" and secs.get(f.label):
                draft[f.key] = secs[f.label]
    return draft


def draft(product_id: str, stage_id: str) -> dict:
    with session() as s:
        r = _run(s, product_id, stage_id)
        return copy.deepcopy(r.draft) if r.draft is not None else _initial_draft(s, r)


def _touch(r: StageRun) -> str | None:
    """下書きが動いたときの状態の変化。返り値は変化前の状態（変化なしなら None）。"""
    old = r.status
    if old == NOT_STARTED:
        r.status = IN_PROGRESS
    elif old in (COMPLETED, NEEDS_RECHECK):
        r.status = REVISING
    return old if old != r.status else None


def set_field(product_id: str, stage_id: str, key: str, value, actor: str, source: str) -> dict:
    fw = fx.FRAMEWORK_BY_STAGE[stage_id]
    f = fw.get(key)
    if f is None:
        raise KeyError(key)
    value = fx.coerce(f, value)
    with session() as s:
        r = _run(s, product_id, stage_id)
        d = copy.deepcopy(r.draft) if r.draft is not None else _initial_draft(s, r)
        d[key] = value
        r.draft = d
        old = _touch(r)
        new = r.status
        s.commit()
    log(product_id, stage_id, "human", actor, f"draft.{source}", body={"field": key, "value": value})
    if old:
        log(product_id, stage_id, "system", "factory", "status", body={"from": old, "to": new})
    return d


# ---------------- 対話 ----------------
def add_chat(product_id: str, stage_id: str, role: str, actor: str, text: str,
             proposals: list | None = None) -> int:
    with session() as s:
        m = ChatMessage(product_id=product_id, stage_id=stage_id, role=role, actor=actor, text=text,
                        proposals=proposals or None)
        s.add(m)
        s.commit()
        mid = m.id
    log(product_id, stage_id, "agent" if role == "assistant" else "human", actor, f"chat.{role}",
        body={"text": text, "proposals": [{"field": p["field"], "value": p["value"]} for p in proposals or []]})
    return mid


def chat(product_id: str, stage_id: str) -> list[dict]:
    with session() as s:
        rows = s.execute(select(ChatMessage).where(ChatMessage.product_id == product_id,
                                                   ChatMessage.stage_id == stage_id)
                         .order_by(ChatMessage.id)).scalars()
        return [{"id": m.id, "role": m.role, "actor": m.actor, "text": m.text,
                 "proposals": m.proposals or [], "at": m.created_at.isoformat()} for m in rows]


def chat_context(product_id: str, stage_id: str) -> dict:
    stage = STAGE_BY_ID[stage_id]
    with session() as s:
        idea = s.get(Product, product_id).idea
    history = chat(product_id, stage_id)
    last_user = next((m["text"] for m in reversed(history) if m["role"] in ("user", "feedback")), "")
    return {"idea": idea, "draft": draft(product_id, stage_id),
            "upstream": confirmed_artifacts(product_id, stage.inputs),
            "history": [{"role": m["role"], "text": m["text"]} for m in history[:-1]],
            "message": last_user}


def decide_proposal(product_id: str, stage_id: str, message_id: int, proposal_id: str,
                    accept: bool, actor: str) -> dict:
    with session() as s:
        m = s.get(ChatMessage, message_id)
        if m is None or m.product_id != product_id or m.stage_id != stage_id:
            raise KeyError("message")
        props = copy.deepcopy(m.proposals or [])
        p = next((x for x in props if x["id"] == proposal_id), None)
        if p is None:
            raise KeyError("proposal")
        if p["status"] != "pending":
            raise ValueError("この案は処理済みです")
        p["status"] = "accepted" if accept else "rejected"
        m.proposals = props
        s.commit()
    if accept:
        return set_field(product_id, stage_id, p["field"], p["value"], actor, "accept")
    log(product_id, stage_id, "human", actor, "draft.reject", body={"field": p["field"]})
    return draft(product_id, stage_id)


# ---------------- 確定と承認 ----------------
def commit(product_id: str, stage_id: str, actor: str, note: str) -> dict:
    """下書きを新しい版として確定する。承認が要るなら承認待ち、要らなければ完了。"""
    stage = STAGE_BY_ID[stage_id]
    fw = fx.FRAMEWORK_BY_STAGE[stage_id]
    d = draft(product_id, stage_id)
    findings = fx.check(fw, d)
    content = fx.to_markdown(stage, fw, d)
    with session() as s:
        r = _run(s, product_id, stage_id)
        r.current_version += 1
        v = r.current_version
        s.add(Artifact(product_id=product_id, stage_id=stage_id, version=v, content=content, data=d,
                       sha256=hashlib.sha256(content.encode()).hexdigest()))
        r.draft = d
        r.audit_findings = findings
        need_approval = r.approval_required
        if need_approval:
            r.status = AWAITING_APPROVAL
            r.pending = {"kind": "approval", "version": v}
        s.commit()
    log(product_id, stage_id, "human", actor, "commit", body={"note": note, "findings": findings}, version=v)
    if not need_approval:
        complete_stage(product_id, stage_id, "Commit")
    return {"version": v, "findings": findings, "approval_required": need_approval}


def complete_stage(product_id: str, stage_id: str, decision: str | None) -> list[str]:
    """版を確定し、確定版が変わったときは参照している下流を「要再確認」にする（設計書 4.3）。"""
    rechecked: list[str] = []
    with session() as s:
        r = _run(s, product_id, stage_id)
        r.status = COMPLETED
        r.pending = None
        prev = r.approved_version
        r.approved_version = r.current_version
        _artifact(s, product_id, stage_id, r.current_version).approved = True
        if prev and prev != r.approved_version:
            for d in downstream_of(stage_id):
                dr = _run(s, product_id, d)
                if dr.status == COMPLETED:
                    dr.status = NEEDS_RECHECK
                    rechecked.append(d)
        s.commit()
        version = r.approved_version
    log(product_id, stage_id, "system", "factory", "completed",
        body={"decision": decision, "needs_recheck": rechecked}, version=version)
    return rechecked


def request_changes(product_id: str, stage_id: str, actor: str, comment: str) -> None:
    with session() as s:
        r = _run(s, product_id, stage_id)
        r.status = REVISING
        r.pending = None
        s.commit()
    # 修正指示は対話に残し、AIが次の発言で拾えるようにする
    add_chat(product_id, stage_id, "feedback", actor, f"承認者の修正指示：{comment}")


# ---------------- 設定 ----------------
def update_settings(product_id: str, stage_id: str, actor: str, enabled: bool | None,
                    approval_required: bool | None) -> None:
    with session() as s:
        r = _run(s, product_id, stage_id)
        before = {"enabled": r.enabled, "approval_required": r.approval_required}
        if enabled is not None:
            r.enabled = enabled
        if approval_required is not None:
            r.approval_required = approval_required
        after = {"enabled": r.enabled, "approval_required": r.approval_required}
        # 承認待ちのまま承認を外したら、その版で確定する
        release = not r.approval_required and r.status == AWAITING_APPROVAL
        s.commit()
    if before != after:
        log(product_id, stage_id, "human", actor, "settings", body={"before": before, "after": after})
    if release:
        complete_stage(product_id, stage_id, "Approval no longer required")


def phase_states(product_id: str) -> list[dict]:
    """各フェーズの状態。フェーズは順序のロックではなく、進み具合と審査の記録だけを持つ。"""
    rs = runs(product_id)
    with session() as s:
        reviews = list(s.execute(select(PhaseReview).where(
            PhaseReview.product_id == product_id).order_by(PhaseReview.created_at)).scalars())
    latest = {rv.phase_id: rv for rv in reviews}
    out = []
    for ph in PHASES:
        active = [sid for sid in ph.stages if rs[sid].enabled]
        done = sum(1 for sid in active if rs[sid].status == COMPLETED)
        rv = latest.get(ph.id)
        out.append({
            "id": ph.id, "name": ph.name, "gate": ph.gate, "gate_question": ph.gate_question,
            "stages": list(ph.stages), "active": len(active), "done": done,
            "complete": bool(active) and done == len(active),
            "review": None if rv is None else {"decision": rv.decision, "reason": rv.reason,
                                               "actor": rv.actor, "at": rv.created_at.isoformat()},
        })
    return out


def all_stage_ids():
    return [s.id for s in STAGES]
