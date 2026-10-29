"""ステージの対話1往復を ADK 2.x の Workflow で組む。

ビルダーの発言 → AIの発言と書き換え案（converse）→ 案を項目の型で検査して保存（screen）

対話の履歴は工場DB（chat_messages）が正本。ADK のセッションはステージごとに1つ持ち、
各往復の実行記録（イベント）を工場DBと同じDBに残す。案を下書きに反映するのは人の
「採用」操作だけで、AIは下書きを直接書き換えない。
"""
from __future__ import annotations

import json
import uuid
from typing import Any

from google.adk.agents.context import Context
from google.adk.workflow import START, Workflow

from . import collab, llm, llmconf, ontology, repo
from . import frameworks as fx
from .stages import STAGE_BY_ID


def _ids(ctx: Context) -> tuple[str, str]:
    return ctx.state["pf_product_id"], ctx.state["pf_stage_id"]


def _chat_session(ctx: Context) -> str | None:
    return ctx.state.get("pf_chat_session_id")


def converse(ctx: Context, node_input: Any):
    product_id, stage_id = _ids(ctx)
    stage = STAGE_BY_ID[stage_id]
    fw = fx.FRAMEWORK_BY_STAGE[stage_id]
    c = repo.chat_context(product_id, stage_id, _chat_session(ctx))
    conn = llmconf.resolve(c["tenant_id"])
    # 会話で確定した決定記録も、上流の成果物と同じく前提として渡す
    ds = collab.stage_decisions(product_id, stage_id, fx.ids_in(json.dumps(c["draft"], ensure_ascii=False)))
    # 社内の用語・組織・業務（オントロジー）は、扱う文章に出てくる語に関係する部分だけを渡す
    seen = [c["message"], c["idea"], json.dumps(c["draft"], ensure_ascii=False), *c["upstream"].values()]
    onto = ontology.context_for(c["tenant_id"], " ".join(seen))
    if onto:
        c["upstream"]["社内の用語と関係"] = onto
    from . import team
    # PdM が工程の画面で担当と話したら、担当からの PdM 宛ては読んだことにする
    team.mark_read_from(product_id, stage_id)
    me = team.stage_context(product_id, stage_id)
    from .imports import docs_context
    docs = docs_context(product_id, stage_id)
    if docs:
        c["upstream"]["取り込んだ資料（この工程に関係する箇所）"] = docs
    if me:
        c["upstream"]["担当エージェントとしての前提（使命・戦略・タスク・掲示板）"] = me
    if ds:
        c["upstream"]["決定記録（確定済み）"] = "\n".join(
            f"- {d['key']} {d['title']}：{d['detail']}（理由：{d['rationale'] or '記載なし'}）" for d in ds)
    try:
        from . import attachments
        extra, images = attachments.material(c.get("attachments") or [])
        message = c["message"] + ("\n\n" + extra if extra else "")
        turn = llm.converse(conn, stage, fw, c["idea"], c["draft"], c["upstream"], c["history"], message, images)
    except Exception as e:  # LLM の失敗は対話の中で伝え、下書きには触れない
        why = str(e) if isinstance(e, llm.LLMError) else type(e).__name__
        return {"reply": f"AIの呼び出しに失敗しました（{why}）。もう一度送るか、設定の接続を確かめてください。",
                "proposals": [], "model": conn.chat_model}
    return {"reply": turn.reply, "proposals": [p.model_dump() for p in turn.proposals], "model": conn.chat_model}


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
    model = (node_input or {}).get("model", "")
    msg_id = repo.add_chat(product_id, stage_id, "assistant", f"stage-agent:{stage_id} ({model})",
                           reply, accepted, session_id=_chat_session(ctx))
    return {"message_id": msg_id, "proposals": len(accepted), "dropped": dropped}


def build_chat_workflow() -> Workflow:
    return Workflow(name="stage_chat", edges=[(START, converse, screen)])
