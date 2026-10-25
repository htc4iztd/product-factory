"""ステージの対話でAIの発言と項目の書き換え案を作るLLM呼び出し。

APIキーがない環境（CI・ローカル）では決定的なスタブで動く。スタブは空の項目に
仮の値を提案するので、画面から全ステージを一周できる。
"""
from __future__ import annotations

import json
import os

from pydantic import BaseModel

from .frameworks import Framework, empty_draft, is_filled, spec
from .stages import Stage


def provider() -> str:
    if os.environ.get("PF_LLM", "").lower() == "stub":
        return "stub"
    if os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY"):
        return "gemini"
    return "stub"


def model_name() -> str:
    return os.environ.get("PF_MODEL", "stub" if provider() == "stub" else "gemini-2.5-flash")


class Proposal(BaseModel):
    field: str
    value: str      # list は改行区切り、table は行の JSON 配列
    reason: str


class Turn(BaseModel):
    reply: str
    proposals: list[Proposal]


def _prompt(stage: Stage, fw: Framework, idea: str, draft: dict, upstream: dict[str, str],
            history: list[dict], message: str) -> str:
    ups = "\n\n".join(f"### {k}\n{v}" for k, v in upstream.items()) or "（なし）"
    hist = "\n".join(f"{h['role']}: {h['text']}" for h in history[-20:]) or "（なし）"
    return (
        f"あなたはプロダクト開発の伴走者です。ビルダーと対話しながら「{stage.no} {stage.name}」の"
        f"フレームワーク「{fw.title}」（{fw.summary}）を一緒に作ります。\n\n"
        "## 振る舞い\n"
        "- 日本語で、短く直接的に答える。前置きや称賛は書かない。\n"
        "- 前提があいまいなら、まず1〜2個の具体的な質問で詰める。\n"
        "- 矛盾・飛躍・根拠のない数値を見つけたら指摘する。出典のない数値は「要確認」と書く。\n"
        "- 項目を書き換えるべきときだけ proposals に入れる。書き換えない項目は入れない。\n"
        "- proposals の value は、text はそのまま、list は1行1要素の改行区切り、"
        "table は columns の key を持つオブジェクトの JSON 配列（rows がある表は先頭列にその見出し）。\n\n"
        f"## 項目の定義\n{json.dumps(spec(fw), ensure_ascii=False)}\n\n"
        f"## 現在の値\n{json.dumps(draft, ensure_ascii=False)}\n\n"
        f"## プロダクトの意図\n{idea or '（なし）'}\n\n"
        f"## 上流ステージの確定版\n{ups}\n\n"
        f"## これまでの対話\n{hist}\n\n"
        f"## ビルダーの今回の発言\n{message}\n"
    )


def _stub_value(f, idea: str):
    base = (idea or "このプロダクト")[:30]
    if f.kind == "text":
        return f"{base}の{f.label}（仮）"
    if f.kind == "list":
        return f"{f.label}の候補1（仮）\n{f.label}の候補2（仮）"
    if f.rows:
        rows = [{f.columns[0].key: r, **{c.key: (100 * (len(f.rows) - i) if c.kind == "number" else f"{c.label}（仮）")
                                          for c in f.columns[1:]}} for i, r in enumerate(f.rows)]
    else:
        rows = [{c.key: (i + 1 if c.kind == "number" else f"{c.label}{i + 1}（仮）") for c in f.columns}
                for i in range(2)]
    return json.dumps(rows, ensure_ascii=False)


def _stub(fw: Framework, idea: str, draft: dict, message: str) -> Turn:
    draft = draft or empty_draft(fw)
    named = [f for f in fw.fields if f.label in message]
    if named:
        props = [Proposal(field=f.key, value=_stub_value(f, idea) if f.kind != "text" else f"{message}（反映）",
                          reason="発言を反映") for f in named]
        return Turn(reply=f"{len(props)}項目の書き換えを提案します。", proposals=props)
    empty = [f for f in fw.fields if not is_filled(f, draft.get(f.key))]
    if empty:
        props = [Proposal(field=f.key, value=_stub_value(f, idea), reason="空欄の仮置き") for f in empty]
        return Turn(reply=f"{len(props)}項目の下書きを提案します。採用するものを選んでください。", proposals=props)
    q = fw.prompts[0] if fw.prompts else "どの項目を詰めますか？"
    return Turn(reply=f"すべての項目が埋まっています。次に詰める点として：{q}", proposals=[])


def converse(stage: Stage, fw: Framework, idea: str, draft: dict, upstream: dict[str, str],
             history: list[dict], message: str) -> Turn:
    if provider() == "stub":
        return _stub(fw, idea, draft, message)
    from google import genai  # google-adk の依存に含まれる
    from google.genai import types
    client = genai.Client(api_key=os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY"))
    resp = client.models.generate_content(
        model=model_name(),
        contents=_prompt(stage, fw, idea, draft, upstream, history, message),
        config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=Turn),
    )
    if isinstance(resp.parsed, Turn):
        return resp.parsed
    return Turn.model_validate_json(resp.text or '{"reply": "", "proposals": []}')
