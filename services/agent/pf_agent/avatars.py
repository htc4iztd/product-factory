"""エージェントの顔：プラットフォーム・PM・①〜⑭の担当を、同じ画風のイラストにする（テナントで共通の配役）。

描くのは画像生成AI（Gemini）。描けない環境（スタブ・キーなし）や、まだ描いていない担当は、役割から決まる
人物のイラスト（SVG。肌・髪型・服・持ち物を役割ごとに決めてある）を返す。画面は顔がなくても崩れない。
"""

from __future__ import annotations

from sqlalchemy import select

from . import images, jobs, llmconf
from .db import AgentAvatar, JobRun, session
from .stages import STAGES

KEYS = ("platform", "pm_biz", "pm_design", "pm_impl", *(s.id for s in STAGES))

STYLE = (
    "Character portrait for a product-development team app. Friendly modern flat illustration, soft gradients, "
    "clean vector shapes, consistent art style across the whole cast, head and shoulders, facing slightly toward the "
    "viewer, simple solid pastel background in the given color, no text, no letters, no logos, no frame, centered, "
    "square composition. The character is an AI agent shown as a warm humanlike person (not a robot)."
)
# 役割ごとの人物像と持ち物（顔だけで役割が分かるように）
CHARACTERS = {
    "platform": ("calm platform operations engineer in a control room, tablet showing heartbeat lines and gears, "
                 "watchful and reassuring", "steel blue"),
    "pm_biz": ("business project manager in a smart blazer holding a roadmap with coins and a target, decisive smile",
               "amber"),
    "pm_design": ("design project manager with a headset and a tablet showing connected diagrams, attentive", "violet"),
    "pm_impl": ("delivery project manager with rolled-up sleeves holding a kanban board and a small rocket, energetic",
                "emerald"),
    "s01": ("curious idea maker with a lightbulb pin, sticky notes around, bright eyes", "warm yellow"),
    "s02": ("market analyst with round glasses holding a small bar chart", "teal"),
    "s03": ("competitive researcher with binoculars around the neck, sharp look", "orange"),
    "s04": ("strategist with a chess knight piece in hand, composed", "royal blue"),
    "s05": ("business planner with a calculator and coins, practical expression", "emerald green"),
    "s06": ("UX designer with a sketchbook of user journeys and wireframes, empathetic and observant", "pink"),
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
    role = ("platform operator who watches the whole factory" if key == "platform"
            else "project manager" if key.startswith("pm_") else f"owner of the stage '{key}'")
    return f"{STYLE} Character: {who}. Role: {role}. Background color: {color}."


# 描いていないときの顔：役割ごとに決まった人物のイラスト（肌・髪型・髪色・服・持ち物・背景）
SKIN = ("#f6d7c3", "#eac0a2", "#d9a47f", "#b97f5a", "#8d5a3b")
HAIR = {"black": "#2b2523", "dark": "#4a3226", "brown": "#6b4a32", "auburn": "#8a4b2a", "gray": "#8f8f95",
        "blonde": "#c9a063"}
LOOK = {  # key: (肌, 髪型, 髪色, 服, 背景, 持ち物)
    "platform": (1, "side", "dark", "#2f4b6e", "#c7d7ea", "headset"),
    "pm_biz": (0, "bob", "black", "#b45309", "#fde68a", ""),
    "pm_design": (2, "long", "brown", "#6d28d9", "#ddd6fe", "headset"),
    "pm_impl": (3, "short", "black", "#047857", "#a7f3d0", ""),
    "s01": (0, "curly", "auburn", "#ca8a04", "#fef08a", ""),
    "s02": (1, "side", "black", "#0f766e", "#99f6e4", "glasses"),
    "s03": (4, "buzz", "black", "#c2410c", "#fed7aa", ""),
    "s04": (2, "side", "dark", "#1d4ed8", "#bfdbfe", ""),
    "s05": (1, "bun", "brown", "#15803d", "#bbf7d0", "glasses"),
    "s06": (0, "long", "blonde", "#be185d", "#fbcfe8", ""),
    "s07": (3, "bob", "dark", "#0369a1", "#bae6fd", ""),
    "s08": (2, "short", "black", "#334155", "#cbd5e1", "glasses"),
    "s09": (1, "side", "brown", "#3730a3", "#c7d2fe", "glasses"),
    "s10": (4, "curly", "black", "#0e7490", "#a5f3fc", ""),
    "s11": (0, "short", "auburn", "#4d7c0f", "#d9f99d", "headset"),
    "s12": (2, "buzz", "dark", "#3f3f46", "#e4e4e7", ""),
    "s13": (3, "bun", "black", "#b45309", "#fde68a", "glasses"),
    "s14": (1, "curly", "blonde", "#dc2626", "#fecaca", ""),
}
FRINGE = {
    "short": "M32 42 C31 26 42 21 50 21 C60 21 70 26 68 42 C63 33 55 31 50 31 C44 31 37 33 32 42 Z",
    "side": "M31 44 C30 25 44 20 52 21 C64 22 71 30 69 44 C65 36 58 30 46 32 C40 33 34 37 31 44 Z",
    "bob": "M32 42 C32 26 42 22 50 22 C58 22 68 26 68 42 C62 36 56 34 50 34 C44 34 38 36 32 42 Z",
    "long": "M32 42 C32 26 42 22 50 22 C58 22 68 26 68 42 C62 36 56 34 50 34 C44 34 38 36 32 42 Z",
    "bun": "M32 42 C31 26 42 22 50 22 C60 22 70 26 68 42 C63 33 55 31 50 31 C44 31 37 33 32 42 Z",
    "buzz": "M33 40 C33 27 42 24 50 24 C58 24 67 27 67 40 C62 34 56 32 50 32 C44 32 38 34 33 40 Z",
}


OPACITY = ' opacity=".9"'


def person(key: str) -> bytes:
    """役割から決まる人物のイラスト（画像生成で描くまでの顔。描けない環境でもこれを出す）。"""
    skin_i, style, hair_name, cloth, bg, extra = LOOK.get(key, (1, "short", "dark", "#52525b", "#e4e4e7", ""))
    skin, hair = SKIN[skin_i], HAIR[hair_name]
    back = ""
    if style == "long":
        back = f'<path d="M29 44 C29 30 38 24 50 24 C62 24 71 30 71 44 L73 80 C64 84 36 84 27 80 Z" fill="{hair}"/>'
    elif style == "bob":
        back = f'<ellipse cx="50" cy="48" rx="25" ry="23" fill="{hair}"/>'
    top = (
        "".join(f'<circle cx="{x}" cy="{y}" r="7.5" fill="{hair}"/>'
                for x, y in ((35, 34), (42, 26), (51, 23), (60, 26), (66, 34), (33, 42), (68, 42)))
        if style == "curly"
        else f'<path d="{FRINGE[style]}" fill="{hair}"{OPACITY if style == "buzz" else ""}/>'
    )
    if style == "bun":
        top += f'<circle cx="50" cy="18" r="8" fill="{hair}"/>'
    acc = ""
    if extra == "glasses":
        acc = ('<g fill="none" stroke="#27272a" stroke-width="1.6"><circle cx="43" cy="47" r="5"/>'
               '<circle cx="57" cy="47" r="5"/><path d="M48 47 L52 47"/></g>')
    elif extra == "headset":
        acc = ('<path d="M30 46 C30 20 70 20 70 46" fill="none" stroke="#27272a" stroke-width="2.6"/>'
               '<rect x="26.5" y="41" width="6" height="11" rx="2.5" fill="#27272a"/>'
               '<rect x="67.5" y="41" width="6" height="11" rx="2.5" fill="#27272a"/>'
               '<path d="M30 51 Q33 60 43 59" fill="none" stroke="#27272a" stroke-width="1.6"/>'
               '<circle cx="44" cy="59" r="1.8" fill="#27272a"/>')
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="256" height="256">'
        f'<rect width="100" height="100" fill="{bg}"/>{back}'
        f'<path d="M14 100 C14 79 30 70 50 70 C70 70 86 79 86 100 Z" fill="{cloth}"/>'
        f'<rect x="44" y="58" width="12" height="14" rx="4" fill="{skin}"/>'
        '<path d="M42 70.5 L50 79 L58 70.5" fill="#ffffff" opacity=".85"/>'
        f'<circle cx="32" cy="47" r="4" fill="{skin}"/><circle cx="68" cy="47" r="4" fill="{skin}"/>'
        f'<ellipse cx="50" cy="45" rx="18" ry="20" fill="{skin}"/>{top}'
        f'<path d="M39.5 41.5 Q43 39.5 46.5 41.5 M53.5 41.5 Q57 39.5 60.5 41.5" fill="none" stroke="{hair}" '
        'stroke-width="1.6" stroke-linecap="round"/>'
        '<circle cx="43" cy="47" r="2" fill="#2b2523"/><circle cx="57" cy="47" r="2" fill="#2b2523"/>'
        '<circle cx="40" cy="53" r="2.6" fill="#f08a7a" opacity=".35"/>'
        '<circle cx="60" cy="53" r="2.6" fill="#f08a7a" opacity=".35"/>'
        '<path d="M45 55 Q50 59 55 55" fill="none" stroke="#8a4b3c" stroke-width="1.6" stroke-linecap="round"/>'
        f"{acc}</svg>"
    ).encode()


geometric = person  # 古い名前（呼び出し元の互換）


def get(tenant: str, key: str) -> tuple[bytes, str, str]:
    """（画像, MIME, 版）。描いていなければ役割から決まる人物のイラスト。"""
    if key not in KEYS:
        raise AvatarError(404, "そのエージェントはいません")
    with session() as s:
        a = s.execute(
            select(AgentAvatar).where(AgentAvatar.tenant_id == tenant, AgentAvatar.key == key)
        ).scalar_one_or_none()
        if a is not None:
            return a.data, a.mime, str(int(a.created_at.timestamp()))
    return person(key), "image/svg+xml", "p1"


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
                data, mime = person(k), "image/svg+xml"
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
