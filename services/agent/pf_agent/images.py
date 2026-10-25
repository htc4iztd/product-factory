"""プロダクト・キャンバス：プロダクトの全体像を1枚の絵にする。

絵の元にするのは、①リーンキャンバスと④バリュープロポジションの値（確定版があれば確定版、
なければ下書き）。プロンプトは場面を文章で描写し、画像の中に文字を描かせない
（日本語の文字は崩れやすく、誤読の元になるため）。

APIキーがない環境ではスタブ（SVG）を返す。
"""
from __future__ import annotations

import os
from xml.sax.saxutils import escape

from . import llm, repo
from .stages import STAGE_BY_ID

KINDS = {
    "scene": "利用シーン",
    "ui": "画面イメージ",
    "concept": "コンセプト",
}

# 絵に使う項目（ステージ, 項目, 表示名）
SOURCES = (
    ("s01", "customer_segments", "顧客"),
    ("s01", "problem", "課題"),
    ("s01", "uvp", "独自の価値提案"),
    ("s01", "solution", "ソリューション"),
    ("s04", "target_customer", "狙う顧客"),
    ("s04", "customer_jobs", "顧客の用事"),
    ("s04", "north_star", "北極星指標"),
)


def model_name() -> str:
    if llm.provider() == "stub":
        return "stub"
    return os.environ.get("PF_IMAGE_MODEL", "gemini-3.1-flash-image")


def _text(v) -> str:
    if isinstance(v, list):
        return "／".join(str(x) for x in v if str(x).strip())
    return str(v or "").strip()


def summary(product_id: str) -> list[dict]:
    """絵の元になる情報。確定版を優先し、なければ下書きを使う。"""
    out = []
    for sid, key, label in SOURCES:
        run = repo.get_run(product_id, sid)
        if not run.enabled:
            continue
        art = repo.confirmed_artifact(product_id, sid)
        data, source = (art.data, f"v{art.version}") if art is not None and art.data else (
            repo.draft(product_id, sid), "下書き")
        value = _text((data or {}).get(key))
        if value:
            out.append({"stage": f"{STAGE_BY_ID[sid].no}{STAGE_BY_ID[sid].name}", "label": label,
                        "value": value, "source": source})
    return out


def build_prompt(kind: str, name: str, idea: str, facts: list[dict], note: str) -> str:
    """場面を文章で描く。事実は日本語のまま渡し、絵の中には文字を描かせない。"""
    context = "\n".join(f"- {f['label']}: {f['value']}" for f in facts) or f"- 意図: {idea}"
    scene = {
        "scene": (
            "A photorealistic wide shot showing the target customer described below in an everyday moment, "
            "using this product to solve their problem. Show the before-to-after relief on their face and in "
            "their posture. Natural, honest, unposed. Set the scene in a realistic Japanese home, office or "
            "street that fits the customer. Lit by soft natural window light, warm and optimistic mood. "
            "Shot on a 35mm lens at eye level, shallow depth of field, subtle film grain."
        ),
        "ui": (
            "A clean, modern product UI mockup of this service, shown on a smartphone and a laptop placed "
            "side by side on a light desk, three-quarter view from slightly above. Describe the product as if "
            "it already exists: a calm neutral interface with one indigo accent color, clear hierarchy, cards, "
            "a simple chart where it fits the value proposition. Render any interface copy as abstract grey "
            "placeholder lines and simple icons. Soft studio lighting, crisp focus on the screens."
        ),
        "concept": (
            "An isometric 3D concept illustration that explains the product's value at a glance: on the left, "
            "the customer's current problem shown as a small cluttered scene; in the middle, the product as a "
            "friendly central object; on the right, the improved outcome. Soft matte materials, pastel palette "
            "with an indigo accent, gentle global illumination, generous negative space, centered composition."
        ),
    }[kind]
    extra = f"\nAdditional direction from the builder (Japanese): {note}" if note.strip() else ""
    return (
        f"{scene}\n\n"
        f"Product: \"{name}\". Product context (Japanese, for understanding only — do not write it in the image):\n"
        f"{context}{extra}\n\n"
        "Constraints: no text, letters or numbers anywhere in the image; no watermark; no logos or real brand "
        "names; no recognizable real people. Aspect ratio 16:9."
    )


def _stub_svg(name: str, kind: str, facts: list[dict]) -> bytes:
    uvp = next((f["value"] for f in facts if f["label"] == "独自の価値提案"), "") or "プロダクトの全体像"
    lines = [uvp[i:i + 26] for i in range(0, min(len(uvp), 78), 26)]
    tspans = "".join(f'<tspan x="80" dy="{0 if i == 0 else 44}">{escape(t)}</tspan>' for i, t in enumerate(lines))
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eef0fe"/>
<stop offset="1" stop-color="#ede9fe"/></linearGradient></defs>
<rect width="1600" height="900" fill="url(#g)"/>
<circle cx="1260" cy="420" r="230" fill="#6366f1" opacity=".12"/>
<circle cx="1330" cy="520" r="140" fill="#8b5cf6" opacity=".18"/>
<text x="80" y="120" font-family="sans-serif" font-size="26" fill="#6366f1">{escape(KINDS[kind])}（スタブ）</text>
<text x="80" y="220" font-family="sans-serif" font-size="64" font-weight="700" fill="#18181b">{escape(name)}</text>
<text x="80" y="330" font-family="sans-serif" font-size="34" fill="#3f3f46">{tspans}</text>
</svg>""".encode()


def generate(kind: str, prompt: str, name: str, facts: list[dict]) -> tuple[bytes, str]:
    if model_name() == "stub":
        return _stub_svg(name, kind, facts), "image/svg+xml"
    from google import genai
    from google.genai import types
    client = genai.Client(api_key=os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY"))
    resp = client.models.generate_content(
        model=model_name(), contents=prompt,
        config=types.GenerateContentConfig(response_modalities=["IMAGE"],
                                           image_config=types.ImageConfig(aspect_ratio="16:9")),
    )
    for cand in resp.candidates or []:
        for part in (cand.content.parts if cand.content else None) or []:
            if part.inline_data and part.inline_data.data:
                return part.inline_data.data, part.inline_data.mime_type or "image/png"
    raise RuntimeError("画像が返りませんでした（安全フィルタで止まった可能性があります）")
