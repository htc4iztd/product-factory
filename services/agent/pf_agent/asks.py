"""AI から PdM に話しかけるときの4つの型。報告だけの書き込みはしない（そこで動きが止まるため）。

- question（質問）：PdM に答えてもらう。チャットで返事をすると、その PM が受けて動く
- consult（相談）：選択肢と PM の考えを出し、PdM の考えを聞く。返事はチャットで
- agree_next（ネクストアクションへの合意依頼）：次にやることを示し、「合意」「合意しない」で答えてもらう。
  答えは PM 宛ての Issue になり、PM がすぐ動く
- approve_done（タスクの終了承認依頼）：Issue を終えてよいかを「承認」「否認」で答えてもらう。
  承認で終了、否認で担当に戻して動かす
"""
from __future__ import annotations

import uuid

from pydantic import BaseModel, Field

from .db import Product
from .team import PMS, name_of, strip_deadlines

KINDS = {
    "question": "質問",
    "consult": "相談",
    "agree_next": "ネクストアクションへの合意依頼",
    "approve_done": "タスクの終了承認依頼",
}
RULE = (
    "PdM に話しかけるのは次の4つの型だけ：question（質問）・consult（相談）"
    "・agree_next（ネクストアクションへの合意依頼）・"
    "approve_done（タスクの終了承認依頼）。報告・共有だけの書き込みはしない（PdM の答えがないと進まないことだけ）。"
    "agree_next は next_action に次にやることを、approve_done は issue に終えたい Issue の番号を必ず入れる。"
    "期限や時刻は書かない。"
)


class PdmAsk(BaseModel):
    kind: str = Field(description="question | consult | agree_next | approve_done")
    text: str = Field(description="PdM への問いかけ（何を答えてほしいかがわかるように）")
    next_action: str = Field(default="", description="agree_next：合意してほしい次のアクション")
    issue: int = Field(default=0, description="approve_done：終えたい Issue の番号（agree_next でも関係があれば）")


def send(product: Product, pm: str, ask: PdmAsk) -> dict | None:
    """型と中身を確かめてから、チャット（テナントの全員）と PM の対話に出す。型に合わないものは出さない。"""
    from . import assistant, pms
    from . import issues as iss

    text = strip_deadlines(ask.text).strip()
    if pm not in PMS or ask.kind not in KINDS or not text:
        return None
    label = KINDS[ask.kind]
    actions: list[dict] = []
    issue = None
    if ask.issue:
        try:
            issue = iss.get(product, ask.issue)
        except iss.IssueError:
            issue = None
    if ask.kind == "agree_next":
        nxt = strip_deadlines(ask.next_action).strip()
        if not nxt:
            return None
        actions.append({
            "id": uuid.uuid4().hex[:12], "type": "pm_ask", "status": "pending", "by": pm, "reason": text,
            "title": "次のアクションに合意する",
            "before": f"#{issue['number']} {issue['subject']}" if issue else "（なし）",
            "after": nxt, "args": {"kind": ask.kind, "issue": issue["number"] if issue else 0, "next_action": nxt},
        })
    elif ask.kind == "approve_done":
        if issue is None or issue["status"] in ("closed", "rejected"):
            return None
        actions.append({
            "id": uuid.uuid4().hex[:12], "type": "pm_ask", "status": "pending", "by": pm, "reason": text,
            "title": f"#{issue['number']}「{issue['subject']}」を終える",
            "before": issue["status_label"], "after": "終了",
            "args": {"kind": ask.kind, "issue": issue["number"], "next_action": ""},
        })
    body = f"【{label}】{text}"
    if ask.kind in ("question", "consult"):
        body += f"\n（チャットで @{name_of(pm)} に返事をしてください）"
    pms._say(product.id, pm, "pm", name_of(pm), body)
    return assistant.notify(
        product.tenant_id, product.id, pm, body,
        {"kind": "pm", "pm": pm, "label": name_of(pm), "ask": ask.kind, "ask_label": label}, actions,
    )


def execute(product: Product, user: str, a: dict, approve: bool) -> str:
    """合意依頼・終了承認依頼への答えを、PM（と担当）に返して動かす。"""
    from . import issues as iss
    from . import team

    pm, x = a["by"], a["args"]
    if x["kind"] == "agree_next":
        verdict = "合意しました" if approve else "合意しませんでした（チャットで理由を伝えます）"
        note = f"PdM が次のアクションに{verdict}：{x['next_action']}"
        if x.get("issue"):
            cur = iss.get(product, x["issue"])
            if cur["assignee"] == pm:
                iss.update(product, user, x["issue"], notes=note)  # PdM の書き込みで PM が動く
                return f"#{x['issue']} に書き、{name_of(pm)}が動きます"
        i = iss.create(
            product, user, pm, f"PdM の答え：{x['next_action'][:60]}",
            f"{note}\n\n"
            + ("このとおり進めてください。" if approve else "進め方を考え直し、必要なら PdM に相談してください。")
            + (f"\n関係する Issue：#{x['issue']}" if x.get("issue") else ""),
        )
        return f"#{i['number']} で{name_of(pm)}に伝えました（すぐ動きます）"
    # approve_done
    n = x["issue"]
    if approve:
        iss.update(product, pm, n, notes=f"PdM（{user}）が終了を承認しました。", status="closed", wake=False)
        return f"#{n} を終了にしました"
    cur = iss.get(product, n)
    iss.update(product, pm, n, notes=f"PdM（{user}）は終了を承認しませんでした。"
        f"続けてください（理由はチャットで伝えます）。",
               status="in_progress")
    if cur["assignee"] == pm:
        team.start(product, user, [pm], reason=f"#{n} の終了が否認された")
    return f"#{n} を進行中に戻しました（{name_of(cur['assignee'])}が動きます）"
