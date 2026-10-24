"""工場DBへの読み書き。ワークフローのノードとエンジンの両方から使う。"""
from __future__ import annotations

import hashlib

from sqlalchemy import select

from . import llm
from .db import Artifact, AuditLog, PhaseReview, Product, StageRun, session
from .stages import COMPLETED, NEEDS_RECHECK, PHASES, SKIPPED, STAGE_BY_ID, STAGES, downstream_of


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


def set_status(product_id: str, stage_id: str, status: str) -> None:
    with session() as s:
        r = _run(s, product_id, stage_id)
        old = r.status
        r.status = status
        s.commit()
    if old != status:
        log(product_id, stage_id, "system", "factory", "status", body={"from": old, "to": status})


def set_pending(product_id: str, stage_id: str, pending: dict | None, session_id: str | None = None) -> None:
    with session() as s:
        r = _run(s, product_id, stage_id)
        r.pending = pending
        if session_id:
            r.session_id = session_id
        s.commit()


def save_answers(product_id: str, stage_id: str, answers: str) -> None:
    with session() as s:
        r = _run(s, product_id, stage_id)
        r.answers = answers
        s.commit()


def approved_artifacts(product_id: str, stage_ids) -> dict[str, str]:
    out = {}
    with session() as s:
        for sid in stage_ids:
            r = _run(s, product_id, sid)
            if r.approved_version:
                a = s.execute(select(Artifact).where(
                    Artifact.product_id == product_id, Artifact.stage_id == sid,
                    Artifact.version == r.approved_version)).scalar_one()
                out[f"{STAGE_BY_ID[sid].no} {STAGE_BY_ID[sid].name}"] = a.content
    return out


def produce_artifact(product_id: str, stage_id: str, feedback: list[str]) -> int:
    stage = STAGE_BY_ID[stage_id]
    with session() as s:
        p = s.get(Product, product_id)
        r = _run(s, product_id, stage_id)
        idea, answers = p.idea, r.answers or ""
    upstream = approved_artifacts(product_id, stage.inputs)
    content = llm.generate_artifact(stage, idea, answers, upstream, feedback)
    with session() as s:
        r = _run(s, product_id, stage_id)
        r.current_version += 1
        v = r.current_version
        s.add(Artifact(product_id=product_id, stage_id=stage_id, version=v, content=content,
                       sha256=hashlib.sha256(content.encode()).hexdigest()))
        s.commit()
    log(product_id, stage_id, "agent", f"stage-agent:{stage_id} ({llm.model_name()})",
        "produce", body={"feedback": feedback}, version=v)
    return v


def current_artifact(product_id: str, stage_id: str) -> Artifact | None:
    with session() as s:
        r = _run(s, product_id, stage_id)
        if not r.current_version:
            return None
        return s.execute(select(Artifact).where(
            Artifact.product_id == product_id, Artifact.stage_id == stage_id,
            Artifact.version == r.current_version)).scalar_one()


def record_audit(product_id: str, stage_id: str, findings: list[str], version: int | None) -> int:
    with session() as s:
        r = _run(s, product_id, stage_id)
        r.audit_findings = findings
        r.audit_retries = r.audit_retries + 1 if findings else 0
        retries = r.audit_retries
        s.commit()
    log(product_id, stage_id, "agent", "audit-agent", "audit",
        body={"passed": not findings, "findings": findings}, version=version)
    return retries


def complete_stage(product_id: str, stage_id: str, decision: str | None) -> list[str]:
    """承認された版を確定し、参照している下流を「要再確認」にする（設計書 4.3）。"""
    rechecked: list[str] = []
    with session() as s:
        r = _run(s, product_id, stage_id)
        r.status = COMPLETED
        r.pending = None
        prev_approved = r.approved_version
        r.approved_version = r.current_version
        a = s.execute(select(Artifact).where(
            Artifact.product_id == product_id, Artifact.stage_id == stage_id,
            Artifact.version == r.current_version)).scalar_one()
        a.approved = True
        if prev_approved and prev_approved != r.approved_version:
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


def phase_states(product_id: str) -> list[dict]:
    """各フェーズの状態。前フェーズの審査で「進む」が出るまで次は開かない。"""
    with session() as s:
        runs = {r.stage_id: r for r in s.execute(
            select(StageRun).where(StageRun.product_id == product_id)).scalars()}
        reviews = list(s.execute(select(PhaseReview).where(
            PhaseReview.product_id == product_id).order_by(PhaseReview.created_at)).scalars())
    latest = {}
    for rv in reviews:
        latest[rv.phase_id] = rv
    out = []
    unlocked = True
    for ph in PHASES:
        done = all(runs[sid].status in (COMPLETED, SKIPPED) for sid in ph.stages)
        rv = latest.get(ph.id)
        out.append({
            "id": ph.id, "name": ph.name, "gate": ph.gate, "gate_question": ph.gate_question,
            "stages": list(ph.stages), "unlocked": unlocked, "complete": done,
            "review": None if rv is None else {"decision": rv.decision, "reason": rv.reason,
                                               "actor": rv.actor, "at": rv.created_at.isoformat()},
        })
        if ph.gate is None:
            unlocked = unlocked and True
        else:
            unlocked = unlocked and done and rv is not None and rv.decision == "proceed"
    return out


def all_stage_ids():
    return [s.id for s in STAGES]
