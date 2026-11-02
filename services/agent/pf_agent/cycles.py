"""サイクルとプロダクトレビュー。

- 1サイクル＝使っている全工程が100%になるまで。工程の%は、確定済み（更新済み）なら100、
  そうでなければ担当の報告の進み具合
  （必須が空なら99まで）。全工程が100%になったら（または PdM が始めたら）プロダクトレビューに入る
- レビュー中は、エージェント・PM 同士の連絡・会議の定期実行を止める（予定の時刻は進めるだけ）
- PdM はレビュー画面で全工程の成果物を読み、次のサイクルの戦略と PM ごとの追加指示を書いて、次のサイクルを始める
- 次のサイクル：工程の%を0に戻し（下書き・版は残す。エンハンスなので作り直しではない）、PM を先に動かす。
  PM は戦略に沿って領域の工程ごとの目標と計画を決め、担当に Issue を出す。担当はその Issue を受けて動く
"""
from __future__ import annotations

import datetime as dt

from pydantic import BaseModel, Field
from sqlalchemy import select

from . import frameworks as fx
from . import fwlib, repo
from .db import Product, ProductCycle, TeamAgent, session
from .stages import COMPLETED, NOT_STARTED, STAGE_BY_ID, STAGES

REVIEW, RUNNING = "review", "running"
MAX_CYCLES = 12
# 位置付けの例（画面の「例を入れる」）
EXAMPLE_PLAN = [
    {"label": "PoC用プロトタイプ", "purpose": "一番大事な仮説が成り立つかを、最小の作りで確かめる。作り込まない",
     "exit": "仮説の判定ができる（続ける・変える・やめるを決められる）"},
    {"label": "MVP", "purpose": "最初の利用者に使ってもらい、価値が届くかを測れる最小の製品にする",
     "exit": "最初の利用者が主要な使い方を最後まで通せる。主要指標が取れる"},
    {"label": "MMP", "purpose": "お金を払ってもらえる品質・機能・運用まで仕上げ、市場に出す",
     "exit": "販売・サポート・運用の準備ができ、出してよいと判断できる"},
]


class CycleError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def _iso(t: dt.datetime | None) -> str | None:
    return (t if t.tzinfo else t.replace(tzinfo=dt.UTC)).isoformat() if t else None


def plan_of(p: Product) -> list[dict]:
    """サイクルの計画。決めていなければ、作ったときの範囲（MVP・PoC）を1サイクル目にする。"""
    if p.cycle_plan:
        return [dict(x) for x in p.cycle_plan]
    return [{"label": "PoC" if p.scope == "poc" else "MVP", "purpose": "", "exit": ""}]


def entry(p: Product, n: int) -> dict | None:
    pl = plan_of(p)
    return pl[n - 1] if 0 < n <= len(pl) else None


def _purpose(e: dict | None) -> str:
    if not e:
        return ""
    return "\n".join(x for x in (e.get("purpose", ""), f"終える条件：{e['exit']}" if e.get("exit") else "") if x)


def current(product_id: str) -> ProductCycle:
    """今のサイクルの記録（なければ作る。位置付けは計画から写す）。"""
    with session() as s:
        p = s.get(Product, product_id)
        n = p.cycle or 1
        c = s.execute(
            select(ProductCycle).where(ProductCycle.product_id == product_id, ProductCycle.number == n)
        ).scalar_one_or_none()
        if c is None:
            e = entry(p, n) or {}
            c = ProductCycle(product_id=product_id, number=n, started_at=p.created_at if n == 1 else _now(),
                             label=e.get("label", ""), purpose=_purpose(e))
            s.add(c)
            s.commit()
        s.expunge(c)
        return c


def progress(product_id: str) -> dict:
    """工程ごとの%（確定済みは100、そうでなければ担当の報告。必須が空なら99まで）と全体。"""
    rs = repo.runs(product_id)
    with session() as s:
        reports = {
            a.key: (a.report or {})
            for a in s.execute(select(TeamAgent).where(TeamAgent.product_id == product_id)).scalars()
        }
    stages = []
    for st in STAGES:
        r = rs[st.id]
        if not r.enabled:
            continue
        if r.status == COMPLETED:
            pct = 100
        else:
            pct = max(0, min(100, int(reports.get(st.id, {}).get("progress") or 0)))
            if pct >= 100 and fx.check(fwlib.of(product_id, st.id), repo.draft(product_id, st.id)):
                pct = 99  # 必須が空のまま100%とは言わない
        stages.append({"id": st.id, "no": st.no, "name": st.name, "pct": pct, "status": r.status})
    total = round(sum(x["pct"] for x in stages) / len(stages)) if stages else 0
    return {"stages": stages, "total": total, "complete": bool(stages) and all(x["pct"] >= 100 for x in stages)}


def cycle_dict(c: ProductCycle) -> dict:
    return {
        "number": c.number,
        "label": c.label or "",
        "purpose": c.purpose or "",
        "started_at": _iso(c.started_at),
        "review_at": _iso(c.review_at),
        "ended_at": _iso(c.ended_at),
        "strategy": c.strategy,
        "directives": c.directives or {},
        "goals": c.goals or {},
        "review_notes": c.review_notes,
        "snapshot": c.snapshot or {},
        "decided_by": c.decided_by,
    }


def state(product: Product) -> dict:
    """画面向け：今のサイクル・状態・%・過去のサイクル。"""
    cur = current(product.id)
    with session() as s:
        p = s.get(Product, product.id)
        past = [
            cycle_dict(c)
            for c in s.execute(
                select(ProductCycle)
                .where(ProductCycle.product_id == product.id, ProductCycle.number < (p.cycle or 1))
                .order_by(ProductCycle.number.desc())
            ).scalars()
        ]
        st = p.cycle_state or RUNNING
        plan, planned = plan_of(p), bool(p.cycle_plan)
    return {"cycle": cur.number, "state": st, "current": cycle_dict(cur), "progress": progress(product.id),
            "past": past, "plan": plan, "planned": planned, "example": EXAMPLE_PLAN}


def set_plan(product: Product, actor: str, items: list[dict]) -> dict:
    """サイクルの計画を決める（PdM）。今のサイクルより短くはできない。今のサイクルの位置付けも書き換わる。"""
    rows = []
    for x in items:
        label = str(x.get("label") or "").strip()[:60]
        if not label:
            raise CycleError(422, "位置付け（PoC用プロトタイプ・MVP など）が空のサイクルがあります")
        rows.append({"label": label, "purpose": str(x.get("purpose") or "").strip()[:2000],
                     "exit": str(x.get("exit") or "").strip()[:1000]})
    if not rows or len(rows) > MAX_CYCLES:
        raise CycleError(422, f"サイクルは1〜{MAX_CYCLES}個で決めてください")
    with session() as s:
        p = s.get(Product, product.id)
        n = p.cycle or 1
        if len(rows) < n:
            raise CycleError(422, f"いまサイクル {n} です。それより少ない計画にはできません")
        p.cycle_plan = rows
        c = s.execute(
            select(ProductCycle).where(ProductCycle.product_id == product.id, ProductCycle.number == n)
        ).scalar_one_or_none()
        if c is not None:
            c.label, c.purpose = rows[n - 1]["label"], _purpose(rows[n - 1])
        s.commit()
    repo.log(product.id, None, "human", actor, "cycle.plan", {"plan": [r["label"] for r in rows]})
    return state(product)


def in_review(product_id: str) -> bool:
    with session() as s:
        p = s.get(Product, product_id)
        return p is not None and (p.cycle_state or RUNNING) == REVIEW


def start_review(product: Product, actor: str, auto: bool = False) -> dict:
    """プロダクトレビューに入る（定期実行を止める）。自動のときは PdM に知らせる。"""
    pr = progress(product.id)
    with session() as s:
        p = s.get(Product, product.id)
        if (p.cycle_state or RUNNING) == REVIEW:
            raise CycleError(409, "もうプロダクトレビュー中です")
        p.cycle_state = REVIEW
        n = p.cycle or 1
        s.commit()
    with session() as s:
        c = s.execute(
            select(ProductCycle).where(ProductCycle.product_id == product.id, ProductCycle.number == n)
        ).scalar_one_or_none()
        if c is None:
            c = ProductCycle(product_id=product.id, number=n, started_at=product.created_at)
            s.add(c)
        c.review_at, c.snapshot = _now(), {x["id"]: x["pct"] for x in pr["stages"]}
        s.commit()
    repo.log(product.id, None, "system" if auto else "human", actor, "cycle.review", {"cycle": n, "auto": auto})
    from . import assistant

    why = "全工程が100%になりました" if auto else f"{actor} がレビューを始めました"
    assistant.notify(
        product.tenant_id,
        product.id,
        "platform",
        f"【プロダクトレビュー】サイクル {n} が終わりました（{why}）。全工程の成果物を確かめ、次のサイクルの戦略と、"
        "PM への追加指示を決めてください。レビューの間、エージェントの定期実行は止めています。",
        {"kind": "review", "label": "プロダクトレビュー", "link": f"/p/{product.id}/review", "cycle": n},
    )
    return state(product)


def check_all() -> list[str]:
    """定期実行から呼ぶ：全工程が100%になったプロダクトをレビューに入れる。"""
    with session() as s:
        ps = list(
            s.execute(
                select(Product).where(Product.status != "stopped", Product.cycle_state != REVIEW)
            ).scalars()
        )
        for p in ps:
            s.expunge(p)
    out = []
    for p in ps:
        try:
            if progress(p.id)["complete"]:
                start_review(p, "factory", auto=True)
                out.append(p.id)
        except CycleError:
            continue
    return out


class GoalOut(BaseModel):
    stage: str = Field(description="工程の id（自分の領域の sNN）")
    goal: str = Field(description="このサイクルでこの工程が達成すること（1〜2文）")
    plan: str = Field(description="そのための計画（何をどう変えるか。箇条書き可）")
    done_when: str = Field(description="完了の条件")


class PlanOut(BaseModel):
    goals: list[GoalOut]


def start_next(
    product: Product, actor: str, strategy: str, directives: dict[str, str], notes: str = "", label: str = ""
) -> dict:
    """次のサイクルを始める：%を0に戻し、PM を先に動かす（PM が工程ごとの目標と計画を決めて担当に Issue を出す）。"""
    from .team import PMS, start

    strategy = strategy.strip()
    if not strategy:
        raise CycleError(422, "次のサイクルの戦略を書いてください")
    directives = {k: v.strip()[:4000] for k, v in (directives or {}).items() if k in PMS and v.strip()}
    with session() as s:
        p = s.get(Product, product.id)
        if (p.cycle_state or RUNNING) != REVIEW:
            raise CycleError(409, "プロダクトレビュー中ではありません")
        old = p.cycle or 1
        n = old + 1
        e = entry(p, n)
        if e is None or (label.strip() and not p.cycle_plan):
            # 計画を超える：位置付けを書いてもらい、計画に足す（計画を決めていなければ、位置付けなしでも進める）
            if label.strip():
                e = {"label": label.strip()[:60], "purpose": "", "exit": ""}
                p.cycle_plan = [*plan_of(p)[: n - 1], e]
            elif p.cycle_plan:
                raise CycleError(422, f"サイクル {n} は計画にありません。位置付けを書くと、計画に足して始めます")
            else:
                e = {"label": "", "purpose": "", "exit": ""}
        c = s.execute(
            select(ProductCycle).where(ProductCycle.product_id == product.id, ProductCycle.number == old)
        ).scalar_one_or_none()
        if c is not None:
            c.ended_at, c.review_notes, c.decided_by = _now(), notes.strip()[:8000], actor
        s.add(
            ProductCycle(
                product_id=product.id, number=n, started_at=_now(), strategy=strategy[:8000], directives=directives,
                goals={}, decided_by=actor, label=e["label"], purpose=_purpose(e),
            )
        )
        p.cycle, p.cycle_state = n, RUNNING
        # 工程の%を0に戻す（下書き・版は残す）。担当の報告と、PM が覚えている「前回の状況」も消す
        for a in s.execute(select(TeamAgent).where(TeamAgent.product_id == product.id)).scalars():
            if a.key in STAGE_BY_ID:
                a.report = {**(a.report or {}), "progress": 0, "health": "green",
                            "summary": f"サイクル {n} の目標を待っています", "blockers": [], "next": []}
            if a.key in PMS:
                a.memory = {**(a.memory or {}), "seen": {}}
        s.commit()
    rs = repo.runs(product.id)
    for st in STAGES:
        if rs[st.id].enabled and rs[st.id].status != NOT_STARTED:
            repo.set_status(product.id, st.id, NOT_STARTED)
    repo.log(product.id, None, "human", actor, "cycle.start", {"cycle": n, "strategy": strategy[:500]})
    job = start(product, actor, list(PMS), reason=f"サイクル {n} の計画", plan_cycle=n)
    return {**state(product), "job_id": job}


def plan_for(product: Product, pm: str, n: int, conn, job_id: str) -> tuple[list[str], str]:
    """PM がサイクルの戦略に沿って、領域の工程ごとの目標と計画を決め、担当に Issue を出す。返り値は起こす担当。"""
    from . import agentrun, llm
    from . import issues as iss
    from .team import DOMAIN, name_of

    c = current(product.id)
    rs = repo.runs(product.id)
    mine = [sid for sid in DOMAIN[pm] if rs[sid].enabled]
    if not mine:
        return [], "領域に使っている工程がない"
    directive = (c.directives or {}).get(pm, "")
    if conn.provider == "stub":
        llm._record("stub", 0, 0)
        out = PlanOut(goals=[
            GoalOut(stage=sid, goal=f"サイクル {n}（{c.label}）"
                f"：{c.strategy[:40]} に沿って{STAGE_BY_ID[sid].name}を見直す",
                    plan="- 戦略に関係する項目を見直す\n- 下流への影響を掲示板で確かめる",
                    done_when="見直した項目が戦略に沿っていて、必須が埋まっている")
            for sid in mine
        ])
    else:
        prep = agentrun.prepare(product.tenant_id, product, pm)
        drafts = "\n\n".join(
            f"## {sid} {STAGE_BY_ID[sid].no}{STAGE_BY_ID[sid].name}\n"
            + fx.to_markdown(STAGE_BY_ID[sid], fwlib.of(product.id, sid), repo.draft(product.id, sid))[:4000]
            for sid in mine
        )
        prompt = (
            f"あなたはプロダクト「{product.name}」（{product.idea}）の{name_of(pm)}です。"
            f"サイクル {n} が始まりました（前のサイクルの成果物はそのまま残っています。作り直しではなくエンハンス）。\n"
            + prep.header()
            + _position_md(c)
            + f"\n\n## このサイクルの戦略（PdM がレビューで決めた）\n{c.strategy}\n"
            + (f"\n## {name_of(pm)}への追加指示\n{directive}\n" if directive else "")
            + "\n## 出力\n- goals：領域の工程ごとに1つ（stage は "
            + "・".join(mine)
            + "）。goal はこのサイクルでその工程が達成すること、plan はそのための計画、done_when は完了の条件。"
            "戦略と追加指示から外れることは書かない。変える必要がない工程は、goal に「変更なし（理由）」と書く。"
            "期限や時刻は書かない。\n\n"
            f"## 領域の工程の今の成果物\n{drafts}"
        )
        out = agentrun.think(conn, prep, prompt, PlanOut)
    goals = dict(current(product.id).goals or {})
    wake = []
    for g in out.goals:
        if g.stage not in mine or not g.goal.strip():
            continue
        goals[g.stage] = {"goal": g.goal.strip()[:600], "plan": g.plan.strip()[:2000],
                          "done_when": g.done_when.strip()[:600], "by": pm}
        if g.goal.strip().startswith("変更なし"):
            continue
        try:
            i = iss.create(
                product, pm, g.stage, f"サイクル {n} の目標：{g.goal.strip()[:120]}",
                f"## このサイクルの戦略\n{c.strategy}\n\n## 目標\n{g.goal}\n\n## 計画\n{g.plan}\n\n"
                f"## 完了の条件\n{g.done_when}\n"
                "\n終わったら resolved にして返してください。",
                tracker="feature", priority="high", stage_id=g.stage, wake=False,
            )
            wake.append(i["assignee"])
        except iss.IssueError:
            continue
    with session() as s:
        row = s.execute(
            select(ProductCycle).where(ProductCycle.product_id == product.id, ProductCycle.number == n)
        ).scalar_one()
        row.goals = {**(row.goals or {}), **goals}
        s.commit()
    return wake, f"サイクル {n} の目標 {len([g for g in out.goals if g.stage in mine])} 件・Issue {len(wake)} 件"


def _position_md(c: ProductCycle) -> str:
    """サイクルの位置付け（PdM が計画で決めた）。作り込みの深さはこれに合わせる。"""
    if not c.label:
        return ""
    return (
        f"\n\n## このサイクルの位置付け：{c.label}\n"
        + (f"{c.purpose}\n" if c.purpose else "")
        + "作り込みの深さ・やること・やらないことは、この位置付けに合わせる（PoC なら確かめるのに要る最小限、"
        "MVP なら最初の利用者に価値が届く最小限、MMP なら売れる品質まで）。\n"
    )


def goal_of(product_id: str, stage_id: str) -> dict | None:
    with session() as s:
        p = s.get(Product, product_id)
        if p is None:
            return None
        c = s.execute(
            select(ProductCycle).where(ProductCycle.product_id == product_id, ProductCycle.number == (p.cycle or 1))
        ).scalar_one_or_none()
        if c is None:
            return None
        g = (c.goals or {}).get(stage_id)
        base = {"cycle": c.number, "strategy": c.strategy, "label": c.label or "", "purpose": c.purpose or ""}
        return {**base, **g} if g else (base if c.strategy or c.label else None)


def pm_md(product_id: str, pm: str) -> str:
    """PM のプロンプトに入れる：このサイクルの戦略・自分への追加指示・領域の工程の目標。"""
    from .team import DOMAIN

    c = current(product_id)
    if not c.strategy and not c.goals and not c.label:
        return ""
    goals = "\n".join(
        f"- {sid} {STAGE_BY_ID[sid].no}{STAGE_BY_ID[sid].name}：{g['goal']}（完了の条件：{g.get('done_when', '')}）"
        for sid, g in (c.goals or {}).items()
        if sid in DOMAIN[pm]
    )
    d = (c.directives or {}).get(pm, "")
    return (
        f"## サイクル {c.number}" + (f"（位置付け：{c.label}）" if c.label else "") + "\n"
        + (f"{c.purpose}\n" if c.purpose else "")
        + (f"戦略：{c.strategy}\n" if c.strategy else "")
        + (f"あなたへの追加指示：{d}\n" if d else "")
        + (f"領域の工程の目標：\n{goals}\n" if goals else "")
        + "\n"
    )


def deliverables(product: Product) -> list[dict]:
    """レビュー画面：全工程の成果物（今の下書きの Markdown と、⑥の UI の画面）。"""
    rs = repo.runs(product.id)
    pr = {x["id"]: x["pct"] for x in progress(product.id)["stages"]}
    out = []
    for st in STAGES:
        r = rs[st.id]
        if not r.enabled:
            continue
        fw = fwlib.of(product.id, st.id)
        d = repo.draft(product.id, st.id)
        item = {"id": st.id, "no": st.no, "name": st.name, "phase": st.phase, "status": r.status,
                "pct": pr.get(st.id, 0), "version": r.approved_version, "missing": fx.check(fw, d),
                "markdown": fx.to_markdown(st, fw, d), "goal": goal_of(product.id, st.id)}
        if st.id == "s06":
            item["ui"] = [{k: p.get(k, "") for k in ("id", "name", "screen", "html", "css")}
                          for p in (d.get("ui") or {}).get("pages") or []]
        out.append(item)
    return out
