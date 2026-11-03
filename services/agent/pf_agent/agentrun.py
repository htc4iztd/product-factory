"""エージェントを1回動かすときの共通の段取り：ペルソナとスキルを読み込み、先に読むツールを実行し、
AI に読むツールを呼ばせ（回数の上限つき）、最後の出力（書くツールの欄だけ）を作る。書くツールの実行は呼び出し側。"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from zoneinfo import ZoneInfo

from pydantic import BaseModel

from . import llm, personas
from . import tools as tl
from .db import Product

MAX_CALLS = 6
JST = ZoneInfo("Asia/Tokyo")


@dataclass
class Prepared:
    lo: personas.Loadout
    ctx: tl.Ctx
    prefetched: str

    def can(self, tool: str) -> bool:
        return tool in self.lo.writes

    def header(self) -> str:
        now = dt.datetime.now(JST)
        return (
            self.lo.text()
            + (f"\n\n## 先に読んだもの\n{self.prefetched}" if self.prefetched else "")
            + f"\n\n## いま\n{now:%Y/%m/%d %H:%M}（日本時間）。エージェントは Issue・掲示板を受けるとすぐ動くので、"
            "相手への期限や時刻（「本日15時までに」など）は書かない。"
        )

    def summary(self) -> str:
        """ジョブの記録に残す：何のスキルで、何を読んだか。"""
        sk = "・".join(s["name"] for s in self.lo.agent_skills)
        read = "、".join(dict.fromkeys(x.split("(")[0] for x in self.ctx.read_log))
        return f"スキル：{sk}" + (f"／読んだ：{read}" if read else "")


def prepare(tenant: str, product: Product | None, key: str) -> Prepared:
    lo = personas.loadout(tenant, key)
    ctx = tl.Ctx(product=product, key=key, tenant=tenant)
    parts = [f"### {name}\n{tl.call(ctx, name, {})}" for name in lo.prefetch]
    return Prepared(lo, ctx, "\n\n".join(parts))


def think(conn, prep: Prepared, prompt: str, schema: type[BaseModel], images=None):
    """読むツールを呼ばせてから、決まった形の出力を作る。"""
    specs = [(n, tl.TOOLS[n].description, tl.TOOLS[n].schema()) for n in prep.lo.reads]

    def runner(name: str, args: dict) -> str:
        if name not in prep.lo.reads:
            return f"エラー：{name} はこのエージェントに割り当てられていません"
        return tl.call(prep.ctx, name, args)

    log = llm.tool_loop(conn, conn.chat_model, prompt, specs, runner, MAX_CALLS) if not images else ""
    final = prompt + (f"\n\n## ツールで読んだもの\n{log}" if log else "")
    return llm._json(conn, conn.chat_model, final, schema, images)


MARK = "<<<JSON>>>"


def _label(name: str, args: dict) -> str:
    """ツールを読んでいることを、人に分かる言葉にする（チャットの「いまやっていること」）。"""
    t = tl.TOOLS.get(name)
    what = (t.description.split("。")[0] if t else name)[:40]
    arg = next((str(v) for v in (args or {}).values() if isinstance(v, (str, int)) and str(v).strip()), "")
    return f"{what}{f'（{arg[:30]}）' if arg else ''}"


def think_stream(conn, prep: Prepared, prompt: str, schema: type[BaseModel], emit):
    """think と同じ答えを、返事の文章を少しずつ出しながら作る。
    読むツールを呼ぶたびに emit({type: step})、返事の文章は emit({type: delta})。
    文章のあとに MARK の行と JSON（actions・evidence）を書かせ、最後に schema の形にまとめる。"""
    import json

    specs = [(n, tl.TOOLS[n].description, tl.TOOLS[n].schema()) for n in prep.lo.reads]

    def runner(name: str, args: dict) -> str:
        if name not in prep.lo.reads:
            return f"エラー：{name} はこのエージェントに割り当てられていません"
        emit({"type": "step", "text": _label(name, args)})
        return tl.call(prep.ctx, name, args)

    log = llm.tool_loop(conn, conn.chat_model, prompt, specs, runner, MAX_CALLS)
    rest = {k: v for k, v in schema.model_json_schema().get("properties", {}).items() if k != "reply"}
    defs = schema.model_json_schema().get("$defs", {})
    fmt = (
        "\n\n## 出力の形（この形を守る）\n"
        "1. まず PdM への返事（上の reply にあたるもの）を Markdown の文章で書く。JSON にしない。\n"
        f"2. 続けて、1行に {MARK} とだけ書く。\n"
        "3. その後に、次のキーを持つ JSON を1つだけ書く（reply は入れない。変えることがなければ actions は []）：\n"
        f"{json.dumps({'properties': rest, '$defs': defs}, ensure_ascii=False)}\n"
    )
    final = prompt + (f"\n\n## ツールで読んだもの\n{log}" if log else "") + fmt
    emit({"type": "step", "text": "返事を書いています"})
    buf = {"all": "", "sent": 0, "done": False}

    def on_delta(t: str) -> None:
        buf["all"] += t
        if buf["done"]:
            return
        i = buf["all"].find(MARK)
        upto = i if i >= 0 else max(buf["sent"], len(buf["all"]) - len(MARK))  # 区切りが途中で切れていても出さない
        if upto > buf["sent"]:
            emit({"type": "delta", "text": buf["all"][buf["sent"]:upto]})
            buf["sent"] = upto
        if i >= 0:
            buf["done"] = True

    text = llm.stream_text(conn, conn.chat_model, final, on_delta)
    reply, _, tail = text.partition(MARK)
    if not buf["done"] and len(reply) > buf["sent"]:
        emit({"type": "delta", "text": reply[buf["sent"]:]})
    try:
        body = tail.strip()
        body = body[body.find("{"): body.rfind("}") + 1] if "{" in body else "{}"
        data = json.loads(body)
        return schema.model_validate({**data, "reply": reply.strip()})
    except Exception:  # noqa: BLE001  形が崩れたら、決まった形でもう一度作る（文章は出し直す）
        emit({"type": "reset"})
        emit({"type": "step", "text": "形を整えて書き直しています"})
        out = llm._json(conn, conn.chat_model, prompt + (f"\n\n## ツールで読んだもの\n{log}" if log else ""), schema)
        emit({"type": "delta", "text": getattr(out, "reply", "")})
        return out
