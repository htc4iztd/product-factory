"""ステージの対話1往復を ADK 2.x の Workflow で組む。

ビルダーの発言 → AIの発言と書き換え案（converse）→ 案を項目の型で検査して保存（screen）

対話の履歴は工場DB（chat_messages）が正本。ADK のセッションはステージごとに1つ持ち、
各往復の実行記録（イベント）を工場DBと同じDBに残す。案を下書きに反映するのは人の
「採用」操作だけで、AIは下書きを直接書き換えない。
"""
from __future__ import annotations

import uuid
from typing import Any

from google.adk.agents.context import Context
from google.adk.workflow import START, Workflow

from . import frameworks as fx
from . import llm, repo
from .stages import STAGE_BY_ID


def _ids(ctx: Context) -> tuple[str, str]:
    return ctx.state["pf_product_id"], ctx.state["pf_stage_id"]


def converse(ctx: Context, node_input: Any):
    product_id, stage_id = _ids(ctx)
    stage = STAGE_BY_ID[stage_id]
    fw = fx.FRAMEWORK_BY_STAGE[stage_id]
    c = repo.chat_context(product_id, stage_id)
    try:
        turn = llm.converse(stage, fw, c["idea"], c["draft"], c["upstream"], c["history"], c["message"])
    except Exception as e:  # LLM の失敗は対話の中で伝え、下書きには触れない
        return {"reply": f"AIの呼び出しに失敗しました（{type(e).__name__}）。もう一度送ってください。",
                "proposals": []}
    return {"reply": turn.reply, "proposals": [p.model_dump() for p in turn.proposals]}


def screen(ctx: Context, node_input: Any):
    product_id, stage_id = _ids(ctx)
    fw = fx.FRAMEWORK_BY_STAGE[stage_id]
    accepted, dropped = [], []
    for p in (node_input or {}).get("proposals", []):
        f = fw.get(p.get("field", ""))
        if f is None:
            dropped.append(f"不明な項目 {p.get('field')}")
            continue
        try:
            value = fx.coerce(f, p.get("value"))
        except (ValueError, TypeError) as e:
            dropped.append(f"{f.label}：値の形が合わない（{e}）")
            continue
        accepted.append({"id": uuid.uuid4().hex[:10], "field": f.key, "value": value,
                         "reason": p.get("reason", ""), "status": "pending"})
    reply = (node_input or {}).get("reply", "")
    if dropped:
        reply += "\n\n（形式が合わず外した案：" + "、".join(dropped) + "）"
    msg_id = repo.add_chat(product_id, stage_id, "assistant", f"stage-agent:{stage_id} ({llm.model_name()})",
                           reply, accepted)
    return {"message_id": msg_id, "proposals": len(accepted), "dropped": dropped}


def build_chat_workflow() -> Workflow:
    return Workflow(name="stage_chat", edges=[(START, converse, screen)])
