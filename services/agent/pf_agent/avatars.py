"""エージェントの顔：司令塔・PM・①〜⑭の担当を、同じ画風のイラストにする（テナントで共通の配役）。

描くのは画像生成AI（Gemini）。描けない環境（スタブ・キーなし）や、まだ描いていない担当は、役割から決まる
幾何学模様の顔（SVG）を返す。画面は顔がなくても崩れない。
"""

from __future__ import annotations

import hashlib
from xml.sax.saxutils import escape

from sqlalchemy import select

from . import images, jobs, llmconf
from .db import AgentAvatar, JobRun, session
from .stages import STAGE_BY_ID, STAGES

KEYS = ("director", "pm", *(s.id for s in STAGES))

STYLE = (
    "Character portrait for a product-development team app. Friendly modern flat illustration, soft gradients, "
    "clean vector shapes, consistent art style across the whole cast, head and shoulders, facing slightly toward the "
    "viewer, simple solid pastel background in the given color, no text, no letters, no logos, no frame, centered, "
    "square composition. The character is an AI agent shown as a warm humanlike person (not a robot)."
)
# 役割ごとの人物像と持ち物（顔だけで役割が分かるように）
CHARACTERS = {
    "director": (
        "calm strategic leader in a dark navy jacket, holding a brass compass, thoughtful confident expression",
        "deep indigo",
    ),
    "pm": ("organized project manager with a headset and a tablet showing a timeline, attentive smile", "violet"),
    "s01": ("curious idea maker with a lightbulb pin, sticky notes around, bright eyes", "warm yellow"),
    "s02": ("market analyst with round glasses holding a small bar chart", "teal"),
    "s03": ("competitive researcher with binoculars around the neck, sharp look", "orange"),
    "s04": ("strategist with a chess knight piece in hand, composed", "royal blue"),
    "s05": ("business planner with a calculator and coins, practical expression", "emerald green"),
    "s06": ("product designer with a stylus and a wireframe card, creative vibe", "pink"),
    "s07": ("business process expert holding a flowchart clipboard, kind", "sky blue"),
    "s08": ("systems requirement engineer with a checklist and a gear badge, precise", "slate blue"),
    "s09": ("software architect with a blueprint scroll of connected boxes, focused", "indigo"),
    "s10": ("cloud infrastructure engineer with a small server and cloud icon pin, calm", "cyan"),
    "s11": ("site reliability operator with a monitoring headset and a pulse line badge, alert", "lime green"),
    "s12": ("programmer with a laptop showing code brackets, relaxed hoodie", "graphite gray"),
    "s13": ("quality tester with a magnifying glass and a check mark badge, meticulous", "amber"),
    "s14": ("release manager with a small rocket in hand, cheerful", "coral red"),
}
PALETTE = ["#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#3b82f6", "#ef4444", "#14b8a6", "#84cc16"]

jobs.JOBS["avatars"] = jobs.JobDef(
    "avatars",
    "エージェントの顔を描く",
    "司令塔・PM・各工程の担当の顔を、同じ画風のイラストにする（テナントで共通）。",
    "エージェントの組織の「顔を描く」",
    30,
)


class AvatarError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def prompt_for(key: str) -> str:
    who, color = CHARACTERS[key]
    role = "commander" if key == "director" else "project manager" if key == "pm" else f"owner of the stage '{key}'"
    return f"{STYLE} Character: {who}. Role: {role}. Background color: {color}."


def geometric(key: str) -> bytes:
    """役割から決まる幾何学模様の顔（描いていないときの代わり）。"""
    h = hashlib.sha256(key.encode()).digest()
    c1, c2 = PALETTE[h[0] % len(PALETTE)], PALETTE[h[1] % len(PALETTE)]
    label = "司" if key == "director" else "PM" if key == "pm" else STAGE_BY_ID[key].no if key in STAGE_BY_ID else "?"
    shapes = "".join(
        f'<circle cx="{20 + (h[i] % 60)}" cy="{20 + (h[i + 1] % 60)}" r="{8 + h[i + 2] % 18}" fill="#fff" '
        f'opacity="{0.10 + (h[i + 3] % 20) / 100:.2f}"/>'
        for i in range(2, 18, 4)
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="256" height="256">'
        f'<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{c1}"/>'
        f'<stop offset="1" stop-color="{c2}"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/>'
        f'{shapes}<text x="50" y="62" text-anchor="middle" font-family="sans-serif" font-size="'
        f'{30 if len(label) > 1 else 38}" font-weight="700" fill="#fff">{escape(label)}</text></svg>'
    ).encode()


def get(tenant: str, key: str) -> tuple[bytes, str, str]:
    """（画像, MIME, 版）。描いていなければ幾何学模様。"""
    if key not in KEYS:
        raise AvatarError(404, "そのエージェントはいません")
    with session() as s:
        a = s.execute(
            select(AgentAvatar).where(AgentAvatar.tenant_id == tenant, AgentAvatar.key == key)
        ).scalar_one_or_none()
        if a is not None:
            return a.data, a.mime, str(int(a.created_at.timestamp()))
    return geometric(key), "image/svg+xml", "0"


def versions(tenant: str) -> dict[str, str]:
    with session() as s:
        rows = s.execute(select(AgentAvatar.key, AgentAvatar.created_at).where(AgentAvatar.tenant_id == tenant)).all()
    return {k: str(int(t.timestamp())) for k, t in rows}


def start(tenant: str, user: str, keys: list[str] | None, redo: bool) -> dict:
    keys = [k for k in KEYS if not keys or k in keys]
    if not redo:
        have = versions(tenant)
        keys = [k for k in keys if k not in have]
    if not keys:
        raise AvatarError(409, "描いていない顔はありません（描き直す場合は redo）")
    conn = llmconf.resolve(tenant)
    job_id = jobs.create(
        "avatars",
        tenant,
        None,
        user,
        {"keys": keys},
        total=len(keys),
        model=conn.image_model,
        tasks=[{"id": k, "name": f"{k} の顔", "deps": []} for k in keys],
    )
    jobs.dispatch(job_id)
    return jobs.run_dict(job_id)


def run(job_id: str) -> None:
    with session() as s:
        j = s.get(JobRun, job_id)
        tenant, keys = j.tenant_id, list(j.params["keys"])
    conn = llmconf.resolve(tenant)
    stub = images.model_name(conn) == "stub"
    for k in keys:
        jobs.step(job_id, f"{k} の顔を描いています")
        with jobs.task(job_id, k):
            prompt = prompt_for(k)
            if stub:
                data, mime = geometric(k), "image/svg+xml"
            else:
                data, mime = images.generate(conn, "free", prompt, k, [], aspect="1:1")
            with session() as s:
                a = s.execute(
                    select(AgentAvatar).where(AgentAvatar.tenant_id == tenant, AgentAvatar.key == k)
                ).scalar_one_or_none()
                if a is None:
                    a = AgentAvatar(tenant_id=tenant, key=k)
                    s.add(a)
                a.data, a.mime, a.prompt, a.model = data, mime, prompt, images.model_name(conn)
                from .db import _now

                a.created_at = _now()
                s.commit()
            jobs.set_task(job_id, k, detail=mime)


jobs.HANDLERS["avatars"] = run
