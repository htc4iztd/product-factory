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
        "- id_prefix のある表は先頭列が ID。既存の行の ID は変えない。新しい行の ID は空でよい（自動で振る）。"
        "ストーリーID・機能要求IDなど他の行を指す列は「US-01, US-03」のように ID で書く。\n"
        "- options のある列は、その選択肢のどれかを入れる。\n"
        "- proposals の value は、text はそのまま、list は1行1要素の改行区切り、"
        "table は columns の key を持つオブジェクトの JSON 配列（rows がある表は先頭列にその見出し）、"
        "flows は [{business: 業務名, lanes: [担当名...], nodes: [{id, type: start|task|decision|system|end, "
        "label, lane: レーンの番号, x: 左からの位置(px)}], edges: [{source, target, label}]}] の JSON。\n\n"
        f"## 項目の定義\n{json.dumps(spec(fw), ensure_ascii=False)}\n\n"
        f"## 現在の値\n{json.dumps(draft, ensure_ascii=False)}\n\n"
        f"## プロダクトの意図\n{idea or '（なし）'}\n\n"
        f"## 上流ステージの最新版\n{ups}\n\n"
        f"## これまでの対話\n{hist}\n\n"
        f"## ビルダーの今回の発言\n{message}\n"
    )


def _stub_value(f, idea: str):
    base = (idea or "このプロダクト")[:30]
    if f.kind == "flows":
        return json.dumps([{"business": "受付業務（仮）", "lanes": ["顧客", "担当者", "システム"],
                            "nodes": [{"id": "n1", "type": "start", "label": "申込む", "lane": 0, "x": 40},
                                      {"id": "n2", "type": "system", "label": "受付を登録", "lane": 2, "x": 240},
                                      {"id": "n3", "type": "decision", "label": "内容に不備?", "lane": 1, "x": 440},
                                      {"id": "n4", "type": "task", "label": "顧客に確認", "lane": 1, "x": 640},
                                      {"id": "n5", "type": "end", "label": "受付完了", "lane": 0, "x": 840}],
                            "edges": [{"source": "n1", "target": "n2"}, {"source": "n2", "target": "n3"},
                                      {"source": "n3", "target": "n4", "label": "はい"},
                                      {"source": "n3", "target": "n5", "label": "いいえ"},
                                      {"source": "n4", "target": "n2"}]}], ensure_ascii=False)
    if f.kind == "text":
        return f"{base}の{f.label}（仮）"
    if f.kind == "list":
        return f"{f.label}の候補1（仮）\n{f.label}の候補2（仮）"
    if f.rows:
        rows = [{f.columns[0].key: r, **{c.key: (c.options[min(2, len(c.options) - 1)] if c.options else
                                                 100 * (len(f.rows) - i) if c.kind == "number" else f"{c.label}（仮）")
                                          for c in f.columns[1:]}} for i, r in enumerate(f.rows)]
    else:
        def cell(c, i):
            if c.options:
                return c.options[0]
            return i + 1 if c.kind == "number" else f"{c.label}{i + 1}（仮）"
        rows = [{c.key: cell(c, i) for c in f.columns} for i in range(2)]
        if f.id_prefix:   # ID は自動で振らせる
            for r in rows:
                r[f.columns[0].key] = ""
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


def summarize(stage: Stage, fw: Framework, messages: list[dict], accepted: list[str], rejected: list[str]) -> str:
    """ステージの対話を、要約・決まったこと・却下したこと・未決事項の Markdown にまとめる。"""
    head = f"# {stage.no} {stage.name}：対話のレポート\n\n"
    decided = "\n".join(f"- {a}" for a in accepted) or "- （なし）"
    dropped = "\n".join(f"- {r}" for r in rejected) or "- （なし）"
    if provider() == "stub":
        said = [m["text"] for m in messages if m["role"] in ("user", "feedback")]
        gist = "\n".join(f"- {t[:80]}" for t in said[-8:]) or "- （発言なし）"
        open_q = "\n".join(f"- {q}" for q in fw.prompts[:3]) or "- （なし）"
        return (f"{head}## 要約\n{len(messages)}件の発言を要約しました（スタブ）。ビルダーの主な発言：\n{gist}\n\n"
                f"## 決まったこと（採用した案）\n{decided}\n\n## 却下した案\n{dropped}\n\n"
                f"## 未決事項・次に詰めること\n{open_q}\n")
    from google import genai
    log = "\n".join(f"[{m['session']}] {m['role']}: {m['text']}" for m in messages[-200:])
    prompt = (
        f"次は「{stage.no} {stage.name}」（{fw.title}）について、ビルダーとAIが交わした対話の記録です。"
        "これを読んだ人が経緯を追わなくても判断できるように、日本語でレポートにまとめてください。\n"
        "見出しは次の4つだけを、この順で使う：「## 要約」「## 決まったこと（採用した案）」「## 却下した案」"
        "「## 未決事項・次に詰めること」。\n"
        "決まったこと・却下した案は、下に渡す一覧を元に、なぜそうしたかを対話から補って書く。"
        "対話にない推測は書かない。未決事項は、対話で出たが結論が出ていない問いと、抜けている観点を挙げる。\n\n"
        f"## 採用した案\n{decided}\n\n## 却下した案\n{dropped}\n\n## 対話\n{log}\n"
    )
    client = genai.Client(api_key=os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY"))
    resp = client.models.generate_content(model=model_name(), contents=prompt)
    return head + (resp.text or "").strip() + "\n"
