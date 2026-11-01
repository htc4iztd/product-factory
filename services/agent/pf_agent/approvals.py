"""ダッシュボードで承認する案：各エージェントから届いた、工程の項目の書き換え案をプロダクトで1か所に集める。

- 工程の案：資料の取り込み（案として出す）などで工程に届いた案（ChatMessage.proposals）
- 定期の仕事の案：定期の仕事（AG-n）の見直しで届いた提案のうち、項目の書き換え案を持つもの（AgentFinding）
どれも「変更前 → 変更後」で見せ、承認したものだけ工程の下書きに入れる（否認なら何も変えない）。
"""

from __future__ import annotations

from sqlalchemy import select

from . import agents, repo
from . import frameworks as fx
from .assistant import _show
from .db import AgentFinding, ChatMessage, ChatSession, Product, session
from .stages import STAGE_BY_ID


class ApprovalError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def _label(sid: str) -> str:
    st = STAGE_BY_ID.get(sid)
    return f"{st.no}{st.name}" if st else sid


def pending(product: Product) -> list[dict]:
    """承認を待つ案（工程の順・新しい順）。"""
    out: list[dict] = []
    drafts: dict[str, dict] = {}

    def before(sid: str, key: str):
        if sid not in drafts:
            drafts[sid] = repo.draft(product.id, sid)
        return drafts[sid].get(key)

    with session() as s:
        msgs = list(
            s.execute(
                select(ChatMessage)
                .where(ChatMessage.product_id == product.id, ChatMessage.proposals.is_not(None))
                .order_by(ChatMessage.id.desc())
            ).scalars()
        )
        titles = {
            x.id: x.title for x in s.execute(select(ChatSession).where(ChatSession.product_id == product.id)).scalars()
        }
        finds = list(
            s.execute(
                select(AgentFinding)
                .where(AgentFinding.product_id == product.id, AgentFinding.status == "open")
                .order_by(AgentFinding.id.desc())
            ).scalars()
        )
        for x in (*msgs, *finds):
            s.expunge(x)
    for m in msgs:
        if m.stage_id not in STAGE_BY_ID:
            continue
        fw = fx.FRAMEWORK_BY_STAGE[m.stage_id]
        for p in m.proposals or []:
            if p.get("status") != "pending":
                continue
            f = fw.get(p.get("field", ""))
            out.append(
                {
                    "kind": "stage",
                    "key": f"m{m.id}:{p['id']}",
                    "stage_id": m.stage_id,
                    "stage_label": _label(m.stage_id),
                    "message_id": m.id,
                    "proposal_id": p["id"],
                    "field": p.get("field"),
                    "field_label": f.label if f else p.get("field"),
                    "before": _show(before(m.stage_id, p.get("field"))),
                    "after": _show(p.get("value")),
                    "reason": p.get("reason", ""),
                    "source": titles.get(m.session_id or "", "") or m.actor,
                    "created_at": m.created_at.isoformat(),
                }
            )
    for f in finds:
        props = f.proposals or []
        if not props or f.stage_id not in STAGE_BY_ID:
            continue
        out.append(
            {
                "kind": "finding",
                "key": f"f{f.id}",
                "stage_id": f.stage_id,
                "stage_label": _label(f.stage_id),
                "finding_id": f.id,
                "field_label": "・".join(p.get("label") or p.get("field", "") for p in props),
                "before": "\n\n".join(
                    f"【{p.get('label') or p.get('field')}】\n{_show(before(f.stage_id, p.get('field')))}"
                    for p in props
                ),
                "after": "\n\n".join(f"【{p.get('label') or p.get('field')}】\n{_show(p.get('value'))}" for p in props),
                "reason": f"{f.title}　{f.body}".strip()[:600],
                "source": "定期の仕事",
                "created_at": f.created_at.isoformat(),
            }
        )
    order = {s: i for i, s in enumerate(STAGE_BY_ID)}
    out.sort(key=lambda x: (order.get(x["stage_id"], 99), x["created_at"]), reverse=False)
    return out


def decide(product: Product, user: str, keys: list[str], accept: bool) -> dict:
    """承認・否認する（まとめて）。1つの失敗で残りを止めない。"""
    items = {x["key"]: x for x in pending(product)}
    done, failed = [], []
    for k in keys:
        x = items.get(k)
        if x is None:
            failed.append(f"{k}：もう処理済みか、見つかりません")
            continue
        try:
            if x["kind"] == "stage":
                repo.decide_proposal(product.id, x["stage_id"], x["message_id"], x["proposal_id"], accept, user)
            else:
                agents.decide(product, user, x["finding_id"], "accept" if accept else "reject")
            done.append(k)
        except (KeyError, ValueError, TypeError, agents.AgentError) as e:
            failed.append(f"{x['stage_label']}「{x['field_label']}」：{getattr(e, 'message', e)}")
    if not done and failed:
        raise ApprovalError(409, "／".join(failed))
    return {"done": done, "failed": failed, "pending": pending(product)}
