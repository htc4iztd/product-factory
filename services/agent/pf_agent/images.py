"""プロダクト・キャンバス：プロダクトの全体像を1枚の絵にする。

絵の元にするのは、①リーンキャンバスと④バリュープロポジションの値（最新版があれば最新版、
なければ下書き）。プロンプトは場面を文章で描写する。写真風・画面・コンセプトの絵には文字を描かせない
（見出しのない絵に崩れた文字が入ると誤読の元になるため）。グラレコは、顧客・課題・価値提案・ソリューションを
日本語の見出しと短い言葉で描かせる（今の画像モデルは日本語を描ける）。
作る人の追加の指示は、決めてある画風や条件より優先する。

画像を描けるのは Gemini（API / Vertex AI）の接続だけ。それ以外の接続やキーがない環境ではスタブ（SVG）を返す。
"""

from __future__ import annotations

from xml.sax.saxutils import escape

from . import llm, repo
from .llmconf import IMAGE_PROVIDERS, Conn
from .stages import STAGE_BY_ID

# free は作る人の指示をそのまま渡す（画風や条件を足さない）。ほかは指示がなくても描ける「型」
KINDS = {
    "free": "自由に描く",
    "graphic": "グラレコ",
    "concept": "コンセプト",
    "scene": "利用シーン",
    "ui": "画面イメージ",
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


def model_name(conn: Conn) -> str:
    if conn.provider not in IMAGE_PROVIDERS or not conn.image_model:
        return "stub"
    return conn.image_model


def _text(v) -> str:
    if isinstance(v, list):
        return "／".join(str(x) for x in v if str(x).strip())
    return str(v or "").strip()


def summary(product_id: str) -> list[dict]:
    """絵の元になる情報。最新版を優先し、なければ下書きを使う。"""
    out = []
    for sid, key, label in SOURCES:
        run = repo.get_run(product_id, sid)
        if not run.enabled:
            continue
        art = repo.confirmed_artifact(product_id, sid)
        data, source = (
            (art.data, f"v{art.version}") if art is not None and art.data else (repo.draft(product_id, sid), "下書き")
        )
        value = _text((data or {}).get(key))
        if value:
            out.append(
                {
                    "stage": f"{STAGE_BY_ID[sid].no}{STAGE_BY_ID[sid].name}",
                    "label": label,
                    "value": value,
                    "source": source,
                }
            )
    return out


def _graphic_prompt(name: str, idea: str, facts: list[dict], note: str) -> str:
    """グラレコ（グラフィックレコーディング）：見出しと短い言葉を日本語で描かせる。画像モデルに日本語で頼む。"""
    by = {f["label"]: f["value"] for f in facts}
    parts = [
        ("顧客", by.get("顧客") or by.get("狙う顧客")),
        ("課題", by.get("課題")),
        ("独自の価値提案", by.get("独自の価値提案")),
        ("ソリューション", by.get("ソリューション")),
    ]
    body = "\n".join(f"- {h}：{v}" for h, v in parts if v) or f"- 意図：{idea}"
    extra = f"\n作る人からの追加の指示（決めてある画風や条件より優先する）：{note}" if note.strip() else ""
    return (
        f"「{name}」を説明する、グラフィックレコーディング（グラレコ）風の1枚の絵を描いてください。\n"
        "画風：白っぽい紙に、太さの違うマーカーで手描きしたイラスト。やわらかい色（青・緑・オレンジ）で塗り、"
        "人物は簡単な線画、アイコン・矢印・吹き出し・見出しの帯で流れを示す。\n"
        "構成：いちばん上に大きな題（プロダクト名）。左上に「顧客」（困っている人物と吹き出し）、右上に「課題」、"
        "中央に「独自の価値提案」（橋や道など、課題から解決へ渡るたとえ）、下に「ソリューション」（しくみの図と、"
        "解決後の笑顔の人物）。各まとまりを矢印でつなぐ。\n"
        "文字：日本語で、見出しと短い言葉（1つ20字くらいまで）だけを書く。下の内容を短く言い換えて使い、"
        "それ以外の文や数字を作らない。文字は正確に、読みやすく。\n"
        f"内容：\n{body}{extra}\n"
        "条件：実在の企業名・ロゴ・実在の人物は描かない。透かしを入れない。横長 16:9。"
    )


def _context(name: str, idea: str, facts: list[dict]) -> str:
    body = "\n".join(f"- {f['label']}：{f['value']}" for f in facts) or f"- 意図：{idea}"
    return f"（参考）プロダクト「{name}」の内容：\n{body}"


def edit_prompt(note: str) -> str:
    """前に描いた絵を元に直す。言われていないところは変えさせない。"""
    return (
        f"この画像を、次の指示のとおりに直してください。\n{note}\n"
        "指示にないところは、できるだけそのまま残してください。"
    )


def build_prompt(kind: str, name: str, idea: str, facts: list[dict], note: str, use_context: bool = True) -> str:
    """自由に描く：作る人の指示をそのまま渡し、プロダクトの内容は参考として添えるだけ（添えないこともできる）。
    型（グラレコ・コンセプト・利用シーン・画面）：場面を文章で描く。グラレコ以外は、絵の中に文字を描かせない。"""
    if kind == "free":
        return note.strip() + (f"\n\n{_context(name, idea, facts)}" if use_context else "")
    if kind == "graphic":
        return _graphic_prompt(name, idea, facts, note)
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
    extra = (
        f"\nAdditional direction from the builder (Japanese). It takes priority over the style and constraints "
        f"above and below when they conflict: {note}"
        if note.strip()
        else ""
    )
    return (
        f"{scene}\n\n"
        f'Product: "{name}". Product context (Japanese, for understanding only — do not write it in the image):\n'
        f"{context}{extra}\n\n"
        "Constraints: no text, letters or numbers anywhere in the image; no watermark; no logos or real brand "
        "names; no recognizable real people. Aspect ratio 16:9."
    )


def _stub_svg(name: str, kind: str, facts: list[dict]) -> bytes:
    uvp = next((f["value"] for f in facts if f["label"] == "独自の価値提案"), "") or "プロダクトの全体像"
    lines = [uvp[i : i + 26] for i in range(0, min(len(uvp), 78), 26)]
    tspans = "".join(f'<tspan x="80" dy="{0 if i == 0 else 44}">{escape(t)}</tspan>' for i, t in enumerate(lines))
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eef0fe"/>
<stop offset="1" stop-color="#ede9fe"/></linearGradient></defs>
<rect width="1600" height="900" fill="url(#g)"/>
<circle cx="1260" cy="420" r="230" fill="#6366f1" opacity=".12"/>
<circle cx="1330" cy="520" r="140" fill="#8b5cf6" opacity=".18"/>
<text x="80" y="120" font-family="sans-serif" font-size="26" fill="#6366f1">{escape(KINDS.get(kind, kind))}\
（スタブ）</text>
<text x="80" y="220" font-family="sans-serif" font-size="64" font-weight="700" fill="#18181b">{escape(name)}</text>
<text x="80" y="330" font-family="sans-serif" font-size="34" fill="#3f3f46">{tspans}</text>
</svg>""".encode()


def generate(
    conn: Conn, kind: str, prompt: str, name: str, facts: list[dict], base: tuple[bytes, str] | None = None,
    aspect: str = "16:9",
) -> tuple[bytes, str]:
    """画像を描く。base（前に描いた画像）を渡すと、その絵を元に直させる。"""
    if model_name(conn) == "stub":
        return _stub_svg(name, kind, facts), "image/svg+xml"
    from google.genai import types

    client = llm._genai(conn)  # 変数に持っておく（回収されると接続が閉じる）
    resp = client.models.generate_content(
        model=model_name(conn),
        contents=[types.Part.from_bytes(data=base[0], mime_type=base[1]), prompt] if base else prompt,
        config=types.GenerateContentConfig(
            response_modalities=["IMAGE"], image_config=types.ImageConfig(aspect_ratio=aspect)
        ),
    )
    llm._record_gemini(model_name(conn), resp)
    for cand in resp.candidates or []:
        for part in (cand.content.parts if cand.content else None) or []:
            if part.inline_data and part.inline_data.data:
                return part.inline_data.data, part.inline_data.mime_type or "image/png"
    raise RuntimeError("画像が返りませんでした（安全フィルタで止まった可能性があります）")
