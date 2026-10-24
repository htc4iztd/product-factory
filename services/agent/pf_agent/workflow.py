"""ステージの共通の型（設計書 5.2）を ADK 2.x の Workflow で組む。

計画 → 確認質問（人）→ 成果物 → 事前監査 →（不合格なら作り直し）→ 承認（人）
→ Approve / Accept as-is なら完了、Request Changes なら作り直し。

人の入力は RequestInput で止める。停止状態は ADK のセッション（工場DBと同じDB）に
残り、Runner を作り直しても FunctionResponse で再開できる（R0で検証済み）。
"""
from __future__ import annotations

import uuid
from typing import Any

from google.adk.agents.context import Context
from google.adk.events import RequestInput
from google.adk.events.event import Event
from google.adk.workflow import START, Workflow

from . import audit as audit_mod
from . import repo
from .stages import ACCEPT_AS_IS, APPROVE, AWAITING_APPROVAL, IN_PROGRESS, REQUEST_CHANGES, STAGE_BY_ID

MAX_AUDIT_RETRIES = 3   # 根拠のない暫定値（未決事項）。R1の実測で決める


def _ids(ctx: Context) -> tuple[str, str]:
    return ctx.state["pf_product_id"], ctx.state["pf_stage_id"]


def plan(ctx: Context, node_input: Any):
    product_id, stage_id = _ids(ctx)
    stage = STAGE_BY_ID[stage_id]
    repo.set_status(product_id, stage_id, IN_PROGRESS)
    questions = list(stage.clarify)
    repo.log(product_id, stage_id, "agent", f"stage-agent:{stage_id}", "plan",
             body={"questions": questions})
    return {"questions": questions}


async def clarify(ctx: Context, node_input: Any):
    yield RequestInput(
        interrupt_id=f"clarify-{uuid.uuid4().hex[:8]}",
        message="確認質問に答えてください",
        payload={"kind": "clarify", "questions": (node_input or {}).get("questions", [])},
    )


def produce(ctx: Context, node_input: Any):
    product_id, stage_id = _ids(ctx)
    feedback: list[str] = []
    if isinstance(node_input, dict) and "findings" in node_input:
        feedback = list(node_input["findings"])
    elif isinstance(node_input, dict) and node_input.get("decision") == REQUEST_CHANGES:
        feedback = [f"ビルダーの修正指示：{node_input.get('comment') or '（コメントなし）'}"]
    else:
        answer = node_input.get("answer") if isinstance(node_input, dict) else node_input
        repo.save_answers(product_id, stage_id, "" if answer is None else str(answer))
    version = repo.produce_artifact(product_id, stage_id, feedback)
    return {"version": version}


def audit(ctx: Context, node_input: Any):
    product_id, stage_id = _ids(ctx)
    stage = STAGE_BY_ID[stage_id]
    art = repo.current_artifact(product_id, stage_id)
    findings = audit_mod.check(stage, art.content if art else "")
    retries = repo.record_audit(product_id, stage_id, findings, art.version if art else None)
    if not findings:
        return Event(output={"version": art.version, "findings": []}, route="pass")
    if retries > MAX_AUDIT_RETRIES:
        # 上限を超えたら、指摘を付けたまま人に渡す
        return Event(output={"version": art.version, "findings": findings, "escalated": True}, route="pass")
    return Event(output={"findings": findings}, route="fail")


async def approve(ctx: Context, node_input: Any):
    product_id, stage_id = _ids(ctx)
    repo.set_status(product_id, stage_id, AWAITING_APPROVAL)
    yield RequestInput(
        interrupt_id=f"approve-{uuid.uuid4().hex[:8]}",
        message="成果物を承認してください",
        payload={"kind": "approval", **(node_input or {})},
    )


def decide(ctx: Context, node_input: Any):
    data = node_input if isinstance(node_input, dict) else {"decision": node_input}
    decision = data.get("decision")
    if decision in (APPROVE, ACCEPT_AS_IS):
        return Event(output=data, route="done")
    return Event(output={"decision": REQUEST_CHANGES, "comment": data.get("comment", "")},
                 route="changes")


def done(ctx: Context, node_input: Any):
    product_id, stage_id = _ids(ctx)
    repo.complete_stage(product_id, stage_id, node_input.get("decision"))
    return {"status": "completed"}


def build_stage_workflow() -> Workflow:
    return Workflow(
        name="stage",
        edges=[
            (START, plan, clarify, produce, audit),
            (audit, {"pass": approve, "fail": produce}),
            (approve, decide),
            (decide, {"done": done, "changes": produce}),
        ],
    )
