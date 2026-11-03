"""工程の担当（その分野の専門家）との相談。

- PdM は工程の担当と直接話せる（チャットの話題が「相談」のとき。ページ /p/{id}/s/{sid}/consult、
  または @⑥UXデザイン担当）。
- 担当は、その分野の知識の束（knowledge/{sid}.md）と工程の中身をもとに、問いを立てて導き、選択肢と根拠を出し、
  弱い前提には率直に指摘する。PdM と合意したことは「合意メモ」に残す（承認依頼 consult_note → 承認で残る）。
- 合意メモは、その工程の担当が動くとき（定期実行・チャット）に必ず読む（agentrun.prepare が足す）。
"""
from __future__ import annotations

import re
from pathlib import Path

from sqlalchemy import select

from .db import AssistantMessage, ConsultNote, session
from .stages import STAGE_BY_ID

KNOWLEDGE_DIR = Path(__file__).parent / "knowledge"
MAX_NOTES = 200


class ConsultError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def _stage(sid: str):
    if sid not in STAGE_BY_ID:
        raise ConsultError(404, f"工程 {sid} はありません")
    return STAGE_BY_ID[sid]


def knowledge(sid: str) -> str:
    """その工程の担当が持つ、分野の知識の束（なければ空。担当のスキルと AI の知識で答える）。"""
    f = KNOWLEDGE_DIR / f"{sid}.md"
    return f.read_text(encoding="utf-8") if f.exists() else ""


def outline(sid: str) -> list[str]:
    """知識の束の見出し（画面で「この担当が持っている知識」として見せる）。"""
    return [m.group(1).strip() for m in re.finditer(r"^## (.+)$", knowledge(sid), re.M)]


def _note(n: ConsultNote) -> dict:
    return {"id": n.id, "text": n.text, "by": n.by, "msg_id": n.msg_id,
            "at": n.created_at.isoformat() if n.created_at else None}


def notes(product_id: str, sid: str) -> list[dict]:
    _stage(sid)
    with session() as s:
        rows = s.execute(select(ConsultNote).where(ConsultNote.product_id == product_id, ConsultNote.stage_id == sid)
                         .order_by(ConsultNote.id)).scalars().all()
        return [_note(n) for n in rows]


def add(product_id: str, sid: str, text: str, by: str, msg_id: int | None = None) -> dict:
    _stage(sid)
    text = (text or "").strip()
    if not text:
        raise ConsultError(422, "合意メモが空です")
    with session() as s:
        n_now = len(s.execute(select(ConsultNote.id).where(ConsultNote.product_id == product_id,
                                                           ConsultNote.stage_id == sid)).all())
        if n_now >= MAX_NOTES:
            raise ConsultError(422, f"合意メモは1つの工程に {MAX_NOTES} 件までです")
        n = ConsultNote(product_id=product_id, stage_id=sid, text=text[:2000], by=by[:200], msg_id=msg_id)
        s.add(n)
        s.commit()
        return _note(n)


def drop(product_id: str, sid: str, note_id: int) -> None:
    with session() as s:
        n = s.get(ConsultNote, note_id)
        if n is None or n.product_id != product_id or n.stage_id != sid:
            raise ConsultError(404, "その合意メモはありません")
        s.delete(n)
        s.commit()


def notes_md(product_id: str, sid: str) -> str:
    rows = notes(product_id, sid)
    return "\n".join(f"- [合意 {i}] {n['text']}" for i, n in enumerate(rows, 1))


def thread(tenant: str, user: str, product_id: str, sid: str, limit: int = 120) -> list[dict]:
    """この工程の担当との相談の発言（新しいものから limit 件を、古い順に）。"""
    from .assistant import message_dict

    _stage(sid)
    with session() as s:
        rows = s.execute(select(AssistantMessage).where(
            AssistantMessage.tenant_id == tenant, AssistantMessage.product_id == product_id,
            (AssistantMessage.user == user) | AssistantMessage.user.is_(None),
        ).order_by(AssistantMessage.id.desc()).limit(600)).scalars().all()
        out = [m for m in rows
               if (m.context or {}).get("kind") == "consult" and (m.context or {}).get("stage_id") == sid]
        return [message_dict(m) for m in reversed(out[:limit])]


def view(tenant: str, user: str, product_id: str, sid: str) -> dict:
    from .team import name_of

    st = _stage(sid)
    return {"stage": {"id": sid, "no": st.no, "name": st.name}, "agent": {"key": sid, "name": name_of(sid)},
            "knowledge": outline(sid), "notes": notes(product_id, sid), "thread": thread(tenant, user, product_id, sid)}


RULES = """## 相談の進め方（あなたはこの分野の専門家として PdM と対話する）
- 目的：PdM と対話しながら、この工程の中身をゼロから磨き上げる。答えを一方的に渡すのではなく、PdM が自分で
  判断できるように導く。
- 始め方：まだ何も決まっていなければ、この工程で最初に決めるべきこと（目的・対象・制約・成功の基準）について、
  答えやすい問いを最大3つだけ出す。問いには、なぜそれを聞くか（どの判断に効くか）を一言添える。
- 毎回の返事：①PdM の発言の要点の受け止め（1文）→ ②専門家としての見立て（原則・手法・事例の型を名前で挙げ、
  なぜこのプロダクトに当てはまるか）→ ③選択肢（2〜3個。それぞれの利点・欠点・向く条件）と推し → ④次の問い（1〜3個）。
- 迎合しない：根拠の弱い前提・思い込み・飛躍は、理由を添えて率直に指摘する。PdM の案が筋が通っていれば、そう言う。
- 知識の使い方：下の「知識の束」と、あなたの持つ専門知識を使う。人名・書名・調査の数字を出すときは、確かなものだけに
  し、不確かなら「（未確認）」と書く。存在しない出典・事例は作らない。
- 合意したら残す：PdM が決めた・同意したことは、actions の consult_note（text に1文で、決めたことと理由）として出す。
  まだ決めていないこと・あなたの提案だけのことは残さない。
- 下書きにする：合意が揃ってきたら、この工程の項目の下書き（set_field）を提案してよい。項目の内容は合意メモと
  食い違わせない。PdM が「下書きにして」と言ったら、合意メモをもとに set_field を出す。
"""
