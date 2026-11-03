"""エージェントとの対話に、その場で添える資料・画像。

添えたものは、その発言のときだけ AI が読む（工程の値や取り込んだ資料にはならない）。
資料（Excel・Word・PowerPoint・テキスト）は文章にして、画像はそのまま AI に渡す（画像を読める接続のとき）。
HTML はソースのまま持つ（AI は構造ごと読める。⑥の UI では、承認するとそのままプロトタイプにできる）。
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
HTML = ("html", "htm")
MAX_HTML = 1_500_000       # HTML のソース（プロトタイプにできる大きさ）
MAX_HTML_FOR_AI = 100_000  # 発言のときに AI に渡す HTML の長さ


def _decode(data: bytes) -> str:
    for enc in ("utf-8-sig", "cp932", "euc-jp"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


class AttachmentError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def add(product: Product, user: str, agent: str, filename: str, content_b64: str) -> dict:
    if agent not in STAGE_BY_ID and agent not in ("pm_biz", "pm_design", "pm_impl", "assistant"):
        raise AttachmentError(422, "添付できるのは PM との対話です")
    filename = (filename or "").strip().replace("/", "_")[:300] or "添付"
    try:
        data = base64.b64decode(content_b64, validate=True)
    except (binascii.Error, ValueError):
        raise AttachmentError(422, "ファイルの中身を読めません") from None
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext in HTML:
        text = _decode(data)
        if len(text) > MAX_HTML:
            raise AttachmentError(413, "HTML が大きすぎます（1.5MB まで）")
        if not text.strip():
            raise AttachmentError(422, "HTML が空です")
        kind, mime, blob = "html", "text/html", None
    elif ext in IMAGE:
        if len(data) > MAX_IMAGE:
            raise AttachmentError(413, "画像が大きすぎます（5MB まで）")
        kind, mime, text, blob = "image", IMAGE[ext], "", data
    else:
        try:
            text, _ = office.extract(filename, data)
        except office.OfficeError as e:
            raise AttachmentError(422, e.message + "（画像は png・jpg・webp・gif、HTML は html・htm）") from None
        if not text.strip():
            raise AttachmentError(422, "文字を読み取れませんでした")
        kind, mime, blob = "doc", "text/plain", None
    with session() as s:
        a = ChatAttachment(tenant_id=product.tenant_id, product_id=product.id, agent=agent, filename=filename,
                           kind=kind, mime=mime, text=text if kind == "html" else text[:MAX_TEXT], data=blob,
                           created_by=user)
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
        docs += [f"### {a.filename}（HTML のソース。添付 id：{a.id}"
                 + (f"。長いので先頭の {MAX_HTML_FOR_AI:,} 文字" if len(a.text or "") > MAX_HTML_FOR_AI else "")
                 + f"）\n```html\n{(a.text or '')[:MAX_HTML_FOR_AI]}\n```" for a in rows if a.kind == "html"]
        images = [(a.data, a.mime) for a in rows if a.kind == "image" and a.data]
        names = [a.filename for a in rows if a.kind == "image"]
    text = ""
    if docs or names:
        text = "## PdM がこの発言に添えたもの（この発言のときだけ読む）\n" + "\n\n".join(docs)
        if names:
            text += "\n画像：" + "、".join(names) + "（この依頼と一緒に渡している）"
    return text, images
