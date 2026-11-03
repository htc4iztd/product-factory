"""ステージの対話でAIの発言と項目の書き換え案を作るLLM呼び出し。

APIキーがない環境（CI・ローカル）では決定的なスタブで動く。スタブは空の項目に
仮の値を提案するので、画面から全ステージを一周できる。
"""
from __future__ import annotations

import contextvars
import ipaddress
import json
import socket
import threading
import time
import urllib.error
import urllib.request
from contextlib import contextmanager
from urllib.parse import urlparse

from pydantic import BaseModel

from . import designs
from .frameworks import Framework, empty_draft, is_filled, spec
from .llmconf import Conn
from .stages import Stage

# Claude API で、拒否されたときに別モデルで答え直す（server-side fallback）を使うモデル
_FALLBACK_MODELS = {"claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1"}


class LLMError(Exception):
    pass


# ---------------- 使用量の記録 ----------------
# ジョブの中で呼んだ LLM のトークン量を、ジョブごとに数える。track() の中の呼び出しだけを数える
_meter: contextvars.ContextVar[dict | None] = contextvars.ContextVar("pf_llm_meter", default=None)
_meter_lock = threading.Lock()
# ジョブの工程（タスク）ごとの使用量。ジョブ全体の _meter と並べて数える
task_meter: contextvars.ContextVar[dict | None] = contextvars.ContextVar("pf_llm_task_meter", default=None)


def new_meter() -> dict:
    return {"calls": 0, "input_tokens": 0, "output_tokens": 0, "by_model": {}}


@contextmanager
def track(meter: dict):
    token = _meter.set(meter)
    try:
        yield meter
    finally:
        _meter.reset(token)


def _record(model: str, input_tokens: int | None, output_tokens: int | None) -> None:
    i, o = int(input_tokens or 0), int(output_tokens or 0)
    for m in (_meter.get(), task_meter.get()):
        if m is None:
            continue
        with _meter_lock:
            m["calls"] += 1
            m["input_tokens"] += i
            m["output_tokens"] += o
            b = m["by_model"].setdefault(model, {"calls": 0, "input_tokens": 0, "output_tokens": 0})
            b["calls"] += 1
            b["input_tokens"] += i
            b["output_tokens"] += o


def _record_claude(model: str, resp) -> None:
    u = getattr(resp, "usage", None)
    if u is not None:
        cached = (getattr(u, "cache_read_input_tokens", 0) or 0) + (getattr(u, "cache_creation_input_tokens", 0) or 0)
        _record(model, (u.input_tokens or 0) + cached, u.output_tokens)


def _record_gemini(model: str, resp) -> None:
    u = getattr(resp, "usage_metadata", None)
    if u is not None:
        out = (getattr(u, "candidates_token_count", 0) or 0) + (getattr(u, "thoughts_token_count", 0) or 0)
        _record(model, getattr(u, "prompt_token_count", 0), out)


class Proposal(BaseModel):
    field: str
    value: str      # list は改行区切り、table は行の JSON 配列
    reason: str


class Turn(BaseModel):
    reply: str
    proposals: list[Proposal]


def value_rules(fw: Framework) -> str:
    """案（proposals）の value の書き方。対話と資料の取り込みで同じものを使う。"""
    return (
        "- id_prefix のある表は先頭列が ID。既存の行の ID は変えない。新しい行の ID は空でよい（自動で振る）。"
        "ストーリーID・機能要求IDなど他の行を指す列は「US-01, US-03」のように ID で書く。\n"
        "- options のある列は、その選択肢のどれかを入れる。\n"
        "- proposals の value は、text はそのまま、list は1行1要素の改行区切り、"
        "table は columns の key を持つオブジェクトの JSON 配列（rows がある表は先頭列にその見出し）、"
        "flows は [{business: 業務名, lanes: [担当名...], nodes: [{id, type: start|task|decision|system|end, "
        "label, lane: レーンの番号, x: 左からの位置(px)}], edges: [{source, target, label}]}] の JSON。\n"
        + "".join(f"- kind が {k} の項目の value は {designs.FORMATS[k]} の JSON。\n"
                  for k in designs.KINDS if any(f.kind == k for f in fw.fields))
        + ("- kind が matrix の項目の value は {q1: [..], q2: [..], q3: [..], q4: [..]} の JSON"
           "（config.quadrants の順に左上・右上・左下・右下）。\n"
           if any(f.kind == "matrix" for f in fw.fields) else "")
        + ("- kind が positioning の項目の value は {items: [{name, x, y, note, self}]} の JSON"
           "（x・y は 0〜100。config.axes の low→high。自社は self: true）。"
           "\n" if any(f.kind == "positioning" for f in fw.fields) else "")
        + ("- kind が ui の項目（UI のプロトタイプ）は提案に含めない（プロトタイプは別の仕組みで作る）。\n"
           if any(f.kind == "ui" for f in fw.fields) else "")
        + ("- kind が diagram の項目の value は {nodes: [{id, label, kind}], edges: [{source, target, label}]}"
           " の JSON。\n"
           if any(f.kind == "diagram" for f in fw.fields) else "")
    )


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
        + value_rules(fw) + "\n"
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
    if f.kind in designs.KINDS:
        return json.dumps(designs.stub(f.kind), ensure_ascii=False)
    if f.kind == "ui":
        return json.dumps({"pages": []}, ensure_ascii=False)
    if f.kind == "matrix":
        labels = (f.config or {}).get("quadrants") or ["左上", "右上", "左下", "右下"]
        return json.dumps({q: [f"{lab}の要素（仮）"] for q, lab in zip(("q1", "q2", "q3", "q4"), labels, strict=False)},
                          ensure_ascii=False)
    if f.kind == "positioning":
        items = [{"name": base, "x": 70, "y": 75, "self": True, "note": "自社（仮）"},
                 {"name": "競合A（仮）", "x": 35, "y": 40}, {"name": "競合B（仮）", "x": 60, "y": 30}]
        return json.dumps({"items": items}, ensure_ascii=False)
    if f.kind == "diagram":
        return json.dumps({"nodes": [{"id": "a", "label": base}, {"id": "b", "label": "顧客（仮）"},
                                     {"id": "c", "label": "パートナー（仮）"}],
                           "edges": [{"source": "a", "target": "b", "label": "価値"},
                                     {"source": "b", "target": "a", "label": "代金"},
                                     {"source": "c", "target": "a", "label": "供給"}]}, ensure_ascii=False)
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
    named = [f for f in fw.fields if f.label in message and f.kind != "ui"]
    if named:
        props = [Proposal(field=f.key, value=_stub_value(f, idea) if f.kind != "text" else f"{message}（反映）",
                          reason="発言を反映") for f in named]
        return Turn(reply=f"{len(props)}項目の書き換えを提案します。", proposals=props)
    empty = [f for f in fw.fields if not is_filled(f, draft.get(f.key)) and f.kind != "ui"]
    if empty:
        props = [Proposal(field=f.key, value=_stub_value(f, idea), reason="空欄の仮置き") for f in empty]
        return Turn(reply=f"{len(props)}項目の下書きを提案します。採用するものを選んでください。", proposals=props)
    q = fw.prompts[0] if fw.prompts else "どの項目を詰めますか？"
    return Turn(reply=f"すべての項目が埋まっています。次に詰める点として：{q}", proposals=[])


def converse(conn: Conn, stage: Stage, fw: Framework, idea: str, draft: dict, upstream: dict[str, str],
             history: list[dict], message: str, images: Images | None = None) -> Turn:
    if conn.provider == "stub":
        _record("stub", 0, 0)
        return _stub(fw, idea, draft, message)
    return _json(conn, conn.chat_model, _prompt(stage, fw, idea, draft, upstream, history, message), Turn, images)


def summarize(conn: Conn, stage: Stage, fw: Framework, messages: list[dict],
              accepted: list[str], rejected: list[str]) -> str:
    """ステージの対話を、要約・決まったこと・却下したこと・未決事項の Markdown にまとめる。"""
    head = f"# {stage.no} {stage.name}：対話のレポート\n\n"
    decided = "\n".join(f"- {a}" for a in accepted) or "- （なし）"
    dropped = "\n".join(f"- {r}" for r in rejected) or "- （なし）"
    if conn.provider == "stub":
        said = [m["text"] for m in messages if m["role"] in ("user", "feedback")]
        gist = "\n".join(f"- {t[:80]}" for t in said[-8:]) or "- （発言なし）"
        open_q = "\n".join(f"- {q}" for q in fw.prompts[:3]) or "- （なし）"
        return (f"{head}## 要約\n{len(messages)}件の発言を要約しました（スタブ）。ビルダーの主な発言：\n{gist}\n\n"
                f"## 決まったこと（採用した案）\n{decided}\n\n## 却下した案\n{dropped}\n\n"
                f"## 未決事項・次に詰めること\n{open_q}\n")
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
    return head + _text(conn, conn.summary_model, prompt).strip() + "\n"


class Intake(BaseModel):
    """新しいプロダクトを作る前の聞き取り。分かったことだけを埋め、足りなければ次の質問を reply に書く。"""
    reply: str
    name: str
    idea: str
    scope: str                    # mvp | poc | 空
    customer_segments: list[str]
    problem: list[str]
    solution: list[str]
    uvp: str
    ready: bool


INTAKE_QUESTIONS = (
    "どんなプロダクトを作りたいですか？思いついたままで構いません。",
    "それは誰の、どんな困りごとを解決しますか？",
    "どうやって解決しますか？最初は小さく出して使ってもらう（MVP）か、技術や需要を確かめる（PoC）かも教えてください。",
)


def _stub_intake(messages: list[dict]) -> Intake:
    said = [m["text"].strip() for m in messages if m["role"] == "user" and m["text"].strip()]
    idea = said[0] if said else ""
    who = said[1] if len(said) > 1 else ""
    how = said[2] if len(said) > 2 else ""
    ready = len(said) >= 3
    reply = INTAKE_QUESTIONS[len(said)] if not ready else (
        "ありがとうございます。右の内容でプロダクトを作れます。直したいところは右で書き換えてください。")
    scope = ("poc" if "poc" in how.lower() else "mvp") if how else ""
    return Intake(reply=reply, name=idea[:20], idea=idea, scope=scope,
                  customer_segments=[who] if who else [], problem=[who] if who else [], solution=[how] if how else [],
                  uvp="", ready=ready)


def intake(conn: Conn, messages: list[dict]) -> Intake:
    if conn.provider == "stub":
        return _stub_intake(messages)
    hist = "\n".join(f"{'ビルダー' if m['role'] == 'user' else 'AI'}: {m['text']}" for m in messages[-30:])
    prompt = (
        "あなたは新しいプロダクトの立ち上げを手伝う聞き手です。ビルダーとの対話から、プロダクトを作るのに必要なことを"
        "聞き取ります。日本語で、短く直接的に、一度に1〜2問だけ聞いてください。前置きや称賛は書かない。\n"
        "聞き取る項目：name（プロダクト名。決まっていなければ短い仮の名前を提案）、idea（何を作るかを1〜2文で）、"
        "customer_segments（誰のためか）、problem（その人の困りごと。上位3つまで）、solution（どう解決するか）、"
        "uvp（選ばれる理由を一文で。分からなければ空）、"
        "scope（小さく出して使ってもらうなら mvp、技術や需要を確かめるなら poc。"
        "分からなければ空）。\n"
        "対話に出たことだけを入れ、推測で埋めない。曖昧な答えは具体的に聞き直す。"
        "name・idea・customer_segments・problem・solution がそろったら ready を true にし、"
        "reply では内容を確かめる一言を書く。"
        "そろっていなければ ready は false にし、reply に次の質問を書く。\n\n"
        f"## これまでの対話\n{hist or '（まだありません。最初の質問をしてください）'}\n"
    )
    return _json(conn, conn.chat_model, prompt, Intake)


def ping(conn: Conn) -> dict:
    """接続テスト。短い文を1つ返してもらい、かかった時間を測る。"""
    if conn.provider == "stub":
        return {"ok": True, "model": "stub", "reply": "スタブ（AIを呼ばない）", "ms": 0}
    t = time.monotonic()
    reply = _text(conn, conn.chat_model, "接続テストです。「OK」とだけ返してください。")
    ms = int((time.monotonic() - t) * 1000)
    return {"ok": True, "model": conn.chat_model, "reply": reply.strip()[:200], "ms": ms}


def list_models(conn: Conn) -> list[str]:
    """接続先が今使えるモデルの名前。モデルは提供元の都合で引退するので、決め打ちせずにここで確かめる。"""
    if conn.provider == "stub":
        return ["stub"]
    names: list[str] = []
    if conn.provider in ("gemini", "vertex"):
        client = _genai(conn)
        cfg = {"query_base": True} if conn.provider == "vertex" else None
        for m in client.models.list(config=cfg):
            actions = m.supported_actions or []
            if actions and "generateContent" not in actions:
                continue
            names.append((m.name or "").rsplit("/", 1)[-1])
        names = [n for n in names if n.startswith("gemini")]
    elif conn.provider == "anthropic":
        client = _anthropic(conn)
        names = [m.id for m in client.models.list()]
    elif conn.provider == "openai":
        if not conn.base_url:
            raise LLMError("OpenAI 互換 API の URL がありません")
        _guard_host(conn)
        headers = {"authorization": f"Bearer {conn.api_key}"} if conn.api_key else {}
        req = urllib.request.Request(conn.base_url.rstrip("/") + "/models", headers=headers)
        data = _wrap(lambda: json.loads(urllib.request.urlopen(req, timeout=30).read()))  # noqa: S310
        names = [m.get("id", "") for m in data.get("data", [])]
    return sorted({n for n in names if n})


# ---------------- 接続ごとの呼び出し ----------------
def _is_claude(conn: Conn, model: str) -> bool:
    return conn.provider == "anthropic" or (conn.provider == "vertex" and model.startswith("claude"))


# 1回の呼び出しの上限（応答が止まっても、ジョブが固まらないように）。検索つきの長い調べものも収まる長さ
TIMEOUT_S = 600
# 利用上限（429 Resource exhausted）は1分あたりの上限が多いので、上限が戻るまで待ってやり直す
# （4秒から倍々・最大60秒・計7回で、最大およそ3分待つ）。それでもだめならジョブの失敗になる
_HTTP = {"timeout": TIMEOUT_S * 1000,
         "retry_options": {"attempts": 7, "initial_delay": 4.0, "max_delay": 60.0, "exp_base": 2.0}}
CLAUDE_RETRIES = 6  # Anthropic の SDK は retry-after を読んで待つ


def _genai(conn: Conn):
    from google import genai  # google-adk の依存に含まれる
    if conn.provider == "vertex":
        if not conn.project:
            raise LLMError("Vertex AI のプロジェクトが決まっていません")
        return genai.Client(vertexai=True, project=conn.project, location=conn.location or "global", http_options=_HTTP)
    if not conn.api_key:
        raise LLMError("Gemini API のキーがありません")
    return genai.Client(api_key=conn.api_key, http_options=_HTTP)


def _anthropic(conn: Conn):
    import anthropic
    if conn.provider == "vertex":
        if not conn.project:
            raise LLMError("Vertex AI のプロジェクトが決まっていません")
        return anthropic.AnthropicVertex(project_id=conn.project, region=conn.location or "global",
                                         timeout=TIMEOUT_S, max_retries=CLAUDE_RETRIES)
    if not conn.api_key:
        raise LLMError("Anthropic API のキーがありません")
    return anthropic.Anthropic(api_key=conn.api_key, timeout=TIMEOUT_S, max_retries=CLAUDE_RETRIES)


Images = list[tuple[bytes, str]]   # 添えた画像（中身, MIME）


def _claude_kwargs(prompt: str, model: str, images: Images | None = None) -> dict:
    import base64
    content: str | list = prompt
    if images:
        pics = [{"type": "image", "source": {"type": "base64", "media_type": m, "data": base64.b64encode(b).decode()}}
                for b, m in images]
        content = [*pics, {"type": "text", "text": prompt}]
    return {"model": model, "max_tokens": 16000, "messages": [{"role": "user", "content": content}]}


def _claude_check(resp) -> None:
    if resp.stop_reason == "refusal":
        raise LLMError("AIがこの依頼への応答を断りました。言い方を変えて送ってください")


def _json(conn: Conn, model: str, prompt: str, schema: type[BaseModel], images: Images | None = None):
    """JSON で答えさせる。images を渡すと、画像も一緒に読ませる（画像を読める接続だけ）。"""
    if _is_claude(conn, model):
        client = _anthropic(conn)
        if conn.provider == "anthropic" and model in _FALLBACK_MODELS:
            resp = client.beta.messages.parse(**_claude_kwargs(prompt, model, images), output_format=schema,
                                              betas=["server-side-fallback-2026-07-01"], fallbacks="default")
        else:
            resp = client.messages.parse(**_claude_kwargs(prompt, model, images), output_format=schema)
        _record_claude(model, resp)
        _claude_check(resp)
        return resp.parsed_output
    if conn.provider in ("gemini", "vertex"):
        from google.genai import types
        client = _genai(conn)  # 変数に持っておく。.models だけを持つと Client が回収されて接続が閉じる
        contents = [*(types.Part.from_bytes(data=b, mime_type=m) for b, m in images or []), prompt]
        resp = client.models.generate_content(
            model=model, contents=contents if images else prompt,
            config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=schema))
        _record_gemini(model, resp)
        if isinstance(resp.parsed, schema):
            return resp.parsed
        return schema.model_validate_json(resp.text or "{}")
    if conn.provider == "openai":
        return schema.model_validate_json(_strip_fence(_openai(conn, model, prompt, schema, images)))
    raise LLMError(f"未対応の接続方式：{conn.provider}")


def _text(conn: Conn, model: str, prompt: str) -> str:
    if _is_claude(conn, model):
        client = _anthropic(conn)
        if conn.provider == "anthropic" and model in _FALLBACK_MODELS:
            resp = client.beta.messages.create(**_claude_kwargs(prompt, model),
                                               betas=["server-side-fallback-2026-07-01"], fallbacks="default")
        else:
            resp = client.messages.create(**_claude_kwargs(prompt, model))
        _record_claude(model, resp)
        _claude_check(resp)
        return "".join(b.text for b in resp.content if b.type == "text")
    if conn.provider in ("gemini", "vertex"):
        client = _genai(conn)
        resp = client.models.generate_content(model=model, contents=prompt)
        _record_gemini(model, resp)
        return resp.text or ""
    if conn.provider == "openai":
        return _openai(conn, model, prompt, None)
    raise LLMError(f"未対応の接続方式：{conn.provider}")


def stream_text(conn: Conn, model: str, prompt: str, on_delta) -> str:
    """文章を少しずつ出す（届いた分から on_delta に渡す）。全体を返す。
    流せない接続・失敗したときは、まとめて1回渡す。"""
    sent = []

    def push(t: str) -> None:
        if t:
            sent.append(t)
            on_delta(t)

    try:
        if _is_claude(conn, model):
            client = _anthropic(conn)
            kw = _claude_kwargs(prompt, model)
            if conn.provider == "anthropic" and model in _FALLBACK_MODELS:
                ctx = client.beta.messages.stream(**kw, betas=["server-side-fallback-2026-07-01"],
                                                  fallbacks="default")
            else:
                ctx = client.messages.stream(**kw)
            with ctx as st:
                for t in st.text_stream:
                    push(t)
                resp = st.get_final_message()
            _record_claude(model, resp)
            _claude_check(resp)
            return "".join(sent)
        if conn.provider in ("gemini", "vertex"):
            client = _genai(conn)
            last = None
            for chunk in client.models.generate_content_stream(model=model, contents=prompt):
                push(chunk.text or "")
                last = chunk
            if last is not None:
                _record_gemini(model, last)
            return "".join(sent)
    except LLMError:
        raise
    except Exception:  # noqa: BLE001  流せなかったら、まとめて出し直す（途中まで出していたらそのまま失敗にする）
        if sent:
            raise
    text = _wrap(lambda: _text(conn, model, prompt))
    push(text)
    return text


def _strip_fence(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else ""
        t = t.rsplit("```", 1)[0]
    return t.strip()


def _guard_host(conn: Conn) -> None:
    # 保存したあとで名前の向き先が変わる場合に備え、呼ぶたびに内部アドレスでないかを見る
    if conn.allow_private:
        return
    host = urlparse(conn.base_url or "").hostname or ""
    for info in socket.getaddrinfo(host, 443):
        if not ipaddress.ip_address(info[4][0]).is_global:
            raise LLMError("内部ネットワークのアドレスには接続できません")


def _openai(conn: Conn, model: str, prompt: str, schema: type[BaseModel] | None, images: Images | None = None) -> str:
    """OpenAI 互換の /chat/completions（Ollama・LM Studio・vLLM など）。

    JSON スキーマ指定に対応しない実装には、json_object とプロンプト中のスキーマで頼み直す。
    """
    if not conn.base_url:
        raise LLMError("OpenAI 互換 API の URL がありません")
    _guard_host(conn)
    url = conn.base_url.rstrip("/") + "/chat/completions"
    headers = {"content-type": "application/json"}
    if conn.api_key:
        headers["authorization"] = f"Bearer {conn.api_key}"

    def call(body: dict) -> str:
        req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=180) as r:  # noqa: S310 - URL は保存時と呼び出し時に検査済み
            data = json.loads(r.read())
        u = data.get("usage") or {}
        _record(model, u.get("prompt_tokens"), u.get("completion_tokens"))
        return data["choices"][0]["message"]["content"] or ""

    import base64
    content: str | list = prompt
    if images:
        content = [*({"type": "image_url", "image_url": {"url": f"data:{m};base64,{base64.b64encode(b).decode()}"}}
                     for b, m in images), {"type": "text", "text": prompt}]
    messages = [{"role": "user", "content": content}]
    if schema is None:
        return _wrap(lambda: call({"model": model, "messages": messages}))
    js = schema.model_json_schema()
    try:
        return call({"model": model, "messages": messages, "response_format": {
            "type": "json_schema", "json_schema": {"name": schema.__name__, "schema": js}}})
    except urllib.error.HTTPError as e:
        if e.code not in (400, 422):
            raise _http_error(e) from None
    except urllib.error.URLError as e:
        raise LLMError(f"接続できません：{e.reason}") from None
    hint = f"\n\n## 出力\n次の JSON スキーマに合う JSON だけを返す。\n{json.dumps(js, ensure_ascii=False)}"
    retry = [{"role": "user", "content": [*content[:-1], {"type": "text", "text": prompt + hint}]
              if images else prompt + hint}]
    return _wrap(lambda: call({"model": model, "messages": retry,
                               "response_format": {"type": "json_object"}}))


def _wrap(fn):
    try:
        return fn()
    except urllib.error.HTTPError as e:
        raise _http_error(e) from None
    except urllib.error.URLError as e:
        raise LLMError(f"接続できません：{e.reason}") from None


def _http_error(e: urllib.error.HTTPError) -> LLMError:
    detail = e.read().decode("utf-8", "replace")[:300]
    return LLMError(f"OpenAI 互換 API がエラーを返しました（{e.code}）：{detail}")


# ---------------- ツールを呼ばせる（読むツールだけ） ----------------
ToolSpec = tuple[str, str, dict]  # 名前・説明・引数の JSON スキーマ
LOOP_HINT = (
    "\n\n## いまの段階\n答えを書く前の下調べです。足りない情報があれば、使えるツールで読んでください"
    "（1回に複数呼んでよい）。十分に読めたら、ツールを呼ばずに「準備完了」とだけ答えてください。"
)


def tool_loop(conn: Conn, model: str, prompt: str, specs: list[ToolSpec], runner, max_calls: int = 6) -> str:
    """読むツールを AI に呼ばせ、読んだ結果を記録して返す（最後の答えは _json で別に作る）。
    runner(name, args) -> str。呼べる回数を超えたら打ち切る。ツールに対応しない接続では何もしない。"""
    if not specs or max_calls <= 0 or conn.provider == "stub":
        return ""
    log: list[str] = []

    def run(name: str, args: dict) -> str:
        out = runner(name, args or {})
        log.append(f"### {name}({json.dumps(args or {}, ensure_ascii=False)})\n{out}")
        return out

    text = prompt + LOOP_HINT
    if _is_claude(conn, model):
        _claude_loop(conn, model, text, specs, run, max_calls)
    elif conn.provider in ("gemini", "vertex"):
        _gemini_loop(conn, model, text, specs, run, max_calls)
    elif conn.provider == "openai":
        _openai_loop(conn, model, text, specs, run, max_calls)
    return "\n\n".join(log)


def _claude_loop(conn: Conn, model: str, text: str, specs: list[ToolSpec], run, max_calls: int) -> None:
    client = _anthropic(conn)
    tools = [{"name": n, "description": d, "input_schema": s} for n, d, s in specs]
    messages: list[dict] = [{"role": "user", "content": text}]
    calls = 0
    while calls < max_calls:
        resp = client.messages.create(model=model, max_tokens=2000, tools=tools, messages=messages)
        _record_claude(model, resp)
        uses = [b for b in resp.content if b.type == "tool_use"]
        if resp.stop_reason != "tool_use" or not uses:
            return
        messages.append({"role": "assistant", "content": [b.model_dump() for b in resp.content]})
        results = []
        for b in uses:
            calls += 1
            out = run(b.name, b.input) if calls <= max_calls else "呼べる回数の上限に達しました"
            results.append({"type": "tool_result", "tool_use_id": b.id, "content": out})
        messages.append({"role": "user", "content": results})


def _gemini_loop(conn: Conn, model: str, text: str, specs: list[ToolSpec], run, max_calls: int) -> None:
    from google.genai import types

    client = _genai(conn)
    tool = types.Tool(function_declarations=[
        types.FunctionDeclaration(name=n, description=d, parameters_json_schema=s) for n, d, s in specs])
    config = types.GenerateContentConfig(
        tools=[tool], automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True))
    contents: list = [types.Content(role="user", parts=[types.Part.from_text(text=text)])]
    calls = 0
    while calls < max_calls:
        resp = client.models.generate_content(model=model, contents=contents, config=config)
        _record_gemini(model, resp)
        fcs = resp.function_calls or []
        if not fcs or not resp.candidates:
            return
        contents.append(resp.candidates[0].content)
        parts = []
        for fc in fcs:
            calls += 1
            out = run(fc.name, dict(fc.args or {})) if calls <= max_calls else "呼べる回数の上限に達しました"
            parts.append(types.Part.from_function_response(name=fc.name, response={"result": out}))
        contents.append(types.Content(role="user", parts=parts))


def _openai_loop(conn: Conn, model: str, text: str, specs: list[ToolSpec], run, max_calls: int) -> None:
    if not conn.base_url:
        return
    _guard_host(conn)
    url = conn.base_url.rstrip("/") + "/chat/completions"
    headers = {"content-type": "application/json"}
    if conn.api_key:
        headers["authorization"] = f"Bearer {conn.api_key}"
    tools = [{"type": "function", "function": {"name": n, "description": d, "parameters": s}} for n, d, s in specs]
    messages: list[dict] = [{"role": "user", "content": text}]
    calls = 0
    while calls < max_calls:
        body = {"model": model, "messages": messages, "tools": tools}
        req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=180) as r:  # noqa: S310 - URL は保存時と呼び出し時に検査済み
                data = json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code in (400, 422):  # ツールに対応しない実装：下調べなしで進める
                return
            raise _http_error(e) from None
        except urllib.error.URLError as e:
            raise LLMError(f"接続できません：{e.reason}") from None
        u = data.get("usage") or {}
        _record(model, u.get("prompt_tokens"), u.get("completion_tokens"))
        msg = data["choices"][0]["message"]
        tcs = msg.get("tool_calls") or []
        if not tcs:
            return
        messages.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": tcs})
        for tc in tcs:
            calls += 1
            try:
                args = json.loads(tc["function"].get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            out = run(tc["function"]["name"], args) if calls <= max_calls else "呼べる回数の上限に達しました"
            messages.append({"role": "tool", "tool_call_id": tc["id"], "content": out})
