"""エージェントとの対話に、その場で添える資料・画像。

添えたものは、その発言のときだけ AI が読む（工程の値や取り込んだ資料にはならない）。
資料（Excel・Word・PowerPoint・テキスト）は文章にして、画像はそのまま AI に渡す（画像を読める接続のとき）。
"""
from __future__ import annotations

import base64
import binascii

from sqlalchemy import select

from . import office
from .db import ChatAttachment, Product, session
from .stages import STAGE_BY_ID

IMAGE = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp", "gif": "image/gif"}
MAX_IMAGE = 5 * 1024 * 1024
MAX_TEXT = 60_000          # 1つの添付から AI に渡す文章の長さ
MAX_PER_MESSAGE = 5


class AttachmentError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def add(product: Product, user: str, agent: str, filename: str, content_b64: str) -> dict:
    if agent not in STAGE_BY_ID and agent != "director":
        raise AttachmentError(422, "添付できるのは工程の担当か司令塔との対話です")
    filename = (filename or "").strip().replace("/", "_")[:300] or "添付"
    try:
        data = base64.b64decode(content_b64, validate=True)
    except (binascii.Error, ValueError):
        raise AttachmentError(422, "ファイルの中身を読めません") from None
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext in IMAGE:
        if len(data) > MAX_IMAGE:
            raise AttachmentError(413, "画像が大きすぎます（5MB まで）")
        kind, mime, text, blob = "image", IMAGE[ext], "", data
    else:
        try:
            text, _ = office.extract(filename, data)
        except office.OfficeError as e:
            raise AttachmentError(422, e.message + "（画像は png・jpg・webp・gif）") from None
        if not text.strip():
            raise AttachmentError(422, "文字を読み取れませんでした")
        kind, mime, blob = "doc", "text/plain", None
    with session() as s:
        a = ChatAttachment(tenant_id=product.tenant_id, product_id=product.id, agent=agent, filename=filename,
                           kind=kind, mime=mime, text=text[:MAX_TEXT], data=blob, created_by=user)
        s.add(a)
        s.commit()
        return brief(a)


def brief(a: ChatAttachment) -> dict:
    return {"id": a.id, "filename": a.filename, "kind": a.kind, "chars": len(a.text or "")}


def take(product: Product, agent: str, ids: list[int]) -> list[dict]:
    """発言に添える。この対話（プロダクト・エージェント）で上げたものだけ。"""
    if len(ids) > MAX_PER_MESSAGE:
        raise AttachmentError(422, f"1回に添えられるのは {MAX_PER_MESSAGE} 個までです")
    if not ids:
        return []
    with session() as s:
        rows = list(s.execute(select(ChatAttachment).where(ChatAttachment.id.in_(ids))).scalars())
        if len(rows) != len(set(ids)) or any(a.product_id != product.id or a.agent != agent for a in rows):
            raise AttachmentError(404, "添付が見つかりません")
        return [brief(a) for a in rows]


def material(ids: list[int]) -> tuple[str, list[tuple[bytes, str]]]:
    """AI に渡すもの：資料の文章と、画像。"""
    if not ids:
        return "", []
    with session() as s:
        rows = list(s.execute(select(ChatAttachment).where(ChatAttachment.id.in_(ids))).scalars())
        docs = [f"### {a.filename}\n{a.text}" for a in rows if a.kind == "doc"]
        images = [(a.data, a.mime) for a in rows if a.kind == "image" and a.data]
        names = [a.filename for a in rows if a.kind == "image"]
    text = ""
    if docs or names:
        text = "## PdM がこの発言に添えたもの（この発言のときだけ読む）\n" + "\n\n".join(docs)
        if names:
            text += "\n画像：" + "、".join(names) + "（この依頼と一緒に渡している）"
    return text, images
