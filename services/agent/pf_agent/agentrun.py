"""エージェントを1回動かすときの共通の段取り：ペルソナとスキルを読み込み、先に読むツールを実行し、
AI に読むツールを呼ばせ（回数の上限つき）、最後の出力（書くツールの欄だけ）を作る。書くツールの実行は呼び出し側。"""

from __future__ import annotations

from dataclasses import dataclass

from pydantic import BaseModel

from . import llm, personas
from . import tools as tl
from .db import Product

MAX_CALLS = 6


@dataclass
class Prepared:
    lo: personas.Loadout
    ctx: tl.Ctx
    prefetched: str

    def can(self, tool: str) -> bool:
        return tool in self.lo.writes

    def header(self) -> str:
        return self.lo.text() + (f"\n\n## 先に読んだもの\n{self.prefetched}" if self.prefetched else "")

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
