"""サイクルとプロダクトレビュー。

- 1サイクル＝使っている①〜⑬の工程が100%になるまで（⑭リリースはサイクルの外。サイクルのあとのリリースで扱う）。
  工程の%は、確定済み（更新済み）なら100、そうでなければ担当の報告の進み具合（必須が空なら99まで）。
  全工程が100%になったら（または PdM が始めたら）プロダクトレビューに入る
- プロダクトレビューは回で進める：各 PM が領域の成果物をレビューして指摘を出す → PdM が読み、要れば PM に修正を指示
  → PM が担当に Issue を出して直させる → 直ったらもう一度 PM がレビュー …。PdM が完了にすると、
  リリースに進む（オンボーディング → リリース前レビュー → リリース。releases.py）か、リリースせずにサイクルを終える
- サイクルが終わったら（done）、PdM が次のサイクルの戦略と PM ごとの追加指示を書いて、次のサイクルを始める。
  工程の%を0に戻し（下書き・版は残す。エンハンス）、PM が先に工程ごとの目標と計画を決めて担当に Issue を出す
- running 以外のあいだは、エージェント・PM 同士の連絡・会議の定期実行を止める（予定の時刻は進めるだけ）。
  レビューの修正・リリースの作業は、そのためのジョブで動く
"""
from __future__ import annotations

import datetime as dt

from pydantic import BaseModel, Field
from sqlalchemy import select

from . import frameworks as fx
from . import fwlib, jobs, llm, llmconf, repo
from .db import AgentIssue, JobRun, Product, ProductCycle, TeamAgent, session
from .stages import COMPLETED, NOT_STARTED, STAGE_BY_ID, STAGES

RUNNING, REVIEW, ONBOARDING, PRERELEASE, RELEASING, DONE = (
    "running", "review", "onboarding", "prerelease", "releasing", "done"
)
STATE_LABEL = {RUNNING: "サイクル実行中", REVIEW: "プロダクトレビュー中",
               ONBOARDING: "オンボーディング中（リリースの定義）",
               PRERELEASE: "リリース前レビュー中", RELEASING: "リリース中", DONE: "サイクル完了（次のサイクル待ち）"}
RELEASE_STAGE = "s14"
CYCLE_STAGES = [st for st in STAGES if st.id != RELEASE_STAGE]  # サイクルの範囲（⑭リリースは外）
DONE_ISSUE = ("resolved", "closed", "rejected")

jobs.JOBS["product_review"] = jobs.JobDef(
    "product_review",
    "プロダクトレビュー（PM のレビュー）",
    "各 PM が、サイクルの成果物のうち自分の領域を読み、問題・食い違い・抜けを指摘する。",
    "プロダクトレビューに入ったとき・「もう一度 PM にレビューさせる」",
    30,
)
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
    for st in CYCLE_STAGES:
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
        "review": _review_view(c.review),
        "release": c.release or {},
    }


def _review_view(rv: dict | None) -> dict:
    """レビューの回に、修正の Issue の今の状態を足す（画面向け）。"""
    rv = dict(rv or {"rounds": []})
    nums = {n for r in rv.get("rounds", []) for f in r.get("fixes", []) for n in f.get("issues", [])}
    return {**rv, "issue_status": _issue_status(rv.get("product_id"), nums) if nums else {}}


def _issue_status(product_id: str | None, nums: set[int]) -> dict:
    if not product_id:
        return {}
    with session() as s:
        return {
            str(i.number): i.status
            for i in s.execute(
                select(AgentIssue).where(AgentIssue.product_id == product_id, AgentIssue.number.in_(nums))
            ).scalars()
        }


def state(product: Product) -> dict:
    """画面向け：今のサイクル・状態・%・過去のサイクル。"""
    # 接続を開いたまま別の接続を開かない（cycle_dict は Issue を読むので、行を取り出してから組み立てる）
    with session() as s:
        p = s.get(Product, product.id)
        rows = list(
            s.execute(
                select(ProductCycle)
                .where(ProductCycle.product_id == product.id, ProductCycle.number < (p.cycle or 1))
                .order_by(ProductCycle.number.desc())
            ).scalars()
        )
        for c in rows:
            s.expunge(c)
        plan, planned = plan_of(p), bool(p.cycle_plan)
    past = [cycle_dict(c) for c in rows]
    refresh_review(product)
    cur = current(product.id)
    with session() as s:
        st = s.get(Product, product.id).cycle_state or RUNNING
    return {"cycle": cur.number, "state": st, "state_label": STATE_LABEL.get(st, st), "current": cycle_dict(cur),
            "progress": progress(product.id), "past": past, "plan": plan, "planned": planned,
            "example": EXAMPLE_PLAN}


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


def state_of(product_id: str) -> str:
    with session() as s:
        p = s.get(Product, product_id)
        return (p.cycle_state or RUNNING) if p is not None else RUNNING


def paused(product_id: str) -> bool:
    """定期実行を止めているか（サイクル実行中以外）。"""
    return state_of(product_id) != RUNNING


def _set_state(product_id: str, st: str) -> None:
    with session() as s:
        s.get(Product, product_id).cycle_state = st
        s.commit()


def _update(product_id: str, fn) -> ProductCycle:
    """今のサイクルの記録を書き換える（fn(row)）。"""
    current(product_id)
    with session() as s:
        p = s.get(Product, product_id)
        c = s.execute(
            select(ProductCycle).where(ProductCycle.product_id == product_id, ProductCycle.number == (p.cycle or 1))
        ).scalar_one()
        fn(c)
        s.commit()
        s.expunge(c)
        return c


def _notify(product: Product, agent: str, text: str, label: str, link: str, **ctx) -> None:
    from . import assistant

    assistant.notify(product.tenant_id, product.id, agent, text,
                     {"kind": "review", "label": label, "link": link, **ctx})


def start_review(product: Product, actor: str, auto: bool = False) -> dict:
    """プロダクトレビューに入る（定期実行を止める）。まず PM がレビューする（回 1）。"""
    pr = progress(product.id)
    with session() as s:
        p = s.get(Product, product.id)
        if (p.cycle_state or RUNNING) != RUNNING:
            raise CycleError(409, f"いまは{STATE_LABEL.get(p.cycle_state, p.cycle_state)}です")
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
        c.review = {"product_id": product.id, "rounds": []}
        s.commit()
    repo.log(product.id, None, "system" if auto else "human", actor, "cycle.review", {"cycle": n, "auto": auto})
    why = "①〜⑬の全工程が100%になりました" if auto else f"{actor} がレビューを始めました"
    _notify(product, "platform",
            f"【プロダクトレビュー】サイクル {n} の作業が終わりました（{why}）。"
            f"いま各 PM が成果物をレビューしています。"
            "レビューが出たら知らせます。その間、エージェントの定期実行は止めています。",
            "プロダクトレビュー", f"/p/{product.id}/review", cycle=n)
    _new_round(product, actor)
    return state(product)


# ---------------- プロダクトレビューの回（PM のレビュー → PdM の修正指示 → 担当が直す → もう一度） ----------------
class FindingOut(BaseModel):
    stage: str = Field(description="指摘する工程の id（sNN）")
    severity: str = Field(description="high | medium | low")
    text: str = Field(description="何が問題か（どの記述か・根拠）")
    fix: str = Field(description="どう直すべきか")


class PmReviewOut(BaseModel):
    verdict: str = Field(description="ok（このままでよい）| issues（直すべき点がある）")
    summary: str = Field(description="領域全体の所見（2〜3文）")
    findings: list[FindingOut]


class FixIssueOut(BaseModel):
    stage: str
    subject: str
    description: str


class FixOut(BaseModel):
    issues: list[FixIssueOut]


def _round(c: ProductCycle) -> dict | None:
    rs = (c.review or {}).get("rounds") or []
    return rs[-1] if rs else None


def _new_round(product: Product, actor: str) -> dict:
    """新しい回を作り、PM のレビュー（ジョブ）を始める。"""
    from .team import PMS, name_of

    conn = llmconf.resolve(product.tenant_id)
    holder: dict = {}

    def fn(c: ProductCycle) -> None:
        rv = dict(c.review or {"product_id": product.id, "rounds": []})
        rounds = list(rv.get("rounds") or [])
        n = len(rounds) + 1
        rounds.append({"n": n, "status": "reviewing", "started_at": _now().isoformat(), "by": actor, "pm": {},
                       "notes": "", "fixes": []})
        rv["rounds"], rv["product_id"] = rounds, product.id
        c.review = rv
        holder["n"] = n
    c = _update(product.id, fn)
    job = jobs.create(
        "product_review", product.tenant_id, product.id, actor, {"cycle": c.number, "round": holder["n"]},
        total=len(PMS), model=conn.chat_model,
        tasks=[{"id": pm, "name": f"{name_of(pm)}のレビュー", "group": "レビュー", "deps": []} for pm in PMS],
    )

    def setjob(c: ProductCycle) -> None:
        rv = dict(c.review)
        rv["rounds"] = [{**r, "job_id": job} if r["n"] == holder["n"] else r for r in rv["rounds"]]
        c.review = rv
    _update(product.id, setjob)
    jobs.dispatch(job)
    return {"round": holder["n"], "job_id": job}


def _pm_material(product: Product, pm: str, prev: dict | None) -> tuple[str, list[str]]:
    from .team import DOMAIN, PMS, name_of

    rs = repo.runs(product.id)
    mine = [sid for sid in DOMAIN[pm] if sid != RELEASE_STAGE and rs[sid].enabled]
    own = "\n\n".join(
        fx.to_markdown(STAGE_BY_ID[sid], fwlib.of(product.id, sid), repo.draft(product.id, sid))[:8000] for sid in mine
    )
    others = "\n".join(
        f"- {name_of(o)}：" + "、".join(
            f"{STAGE_BY_ID[sid].no}{STAGE_BY_ID[sid].name}"
            for sid in DOMAIN[o] if sid != RELEASE_STAGE and rs[sid].enabled
        )
        for o in PMS if o != pm
    )
    before = ""
    if prev:
        r = (prev.get("pm") or {}).get(pm) or {}
        fixes = [f["text"] for f in prev.get("fixes", []) if f.get("pm") == pm]
        before = (
            "## 前の回での自分の指摘\n" + "\n".join(f"- [{x['stage']}] {x['text']}" for x in r.get("findings", []))
            + ("\n## PdM の修正指示\n" + "\n".join(fixes) if fixes else "") + "\n\n"
        )
    return f"{before}## 自分の領域の成果物\n{own}\n\n## ほかの PM の領域\n{others}\n", mine


def run_review(job_id: str) -> None:
    from . import agentrun
    from .team import PMS, name_of

    with session() as s:
        j = s.get(JobRun, job_id)
        product = s.get(Product, j.product_id)
        s.expunge(product)
        rn = j.params["round"]
    conn = llmconf.resolve(product.tenant_id)
    c = current(product.id)
    rounds = (c.review or {}).get("rounds") or []
    prev = next((r for r in rounds if r["n"] == rn - 1), None)
    results: dict[str, dict] = {}
    for pm in PMS:
        with jobs.task(job_id, pm):
            material, mine = _pm_material(product, pm, prev)
            if not mine:
                results[pm] = {"verdict": "ok", "summary": "領域に使っている工程がありません", "findings": []}
                continue
            if conn.provider == "stub":
                llm._record("stub", 0, 0)
                finds = []
                for sid in mine:
                    miss = fx.check(fwlib.of(product.id, sid), repo.draft(product.id, sid))
                    if miss:
                        finds.append(FindingOut(stage=sid, severity="high", text="、".join(miss)[:300],
                                                fix="空の必須項目を埋める"))
                out = PmReviewOut(verdict="issues" if finds else "ok",
                                  summary=f"（スタブ）{name_of(pm)}：領域の {len(mine)} 工程を確かめました。",
                                  findings=finds)
            else:
                prep = agentrun.prepare(product.tenant_id, product, pm)
                prompt = (
                    f"あなたはプロダクト「{product.name}」（{product.idea}）の{name_of(pm)}です。"
                    f"サイクル {c.number} のプロダクトレビュー（第 {rn} 回）で、自分の領域の成果物をレビューします。\n"
                    + prep.header() + _position_md(c)
                    + "\n## 出力\n- verdict：このまま出してよければ ok、直すべき点があれば issues。\n"
                    "- findings：直すべき点だけ。stage は自分の領域の工程（"
                    + "・".join(mine) + "）。severity は high（出せない）・medium（直すべき）・low（あれば良い）。"
                    "text は何が問題か（どの記述か・根拠）、fix はどう直すか。位置付けに対して過剰な指摘はしない。"
                    "前の回の指摘が直っていれば、もう挙げない。期限や時刻は書かない。\n\n" + material[:60000]
                )
                out = agentrun.think(conn, prep, prompt, PmReviewOut)
            finds = [f.model_dump() for f in out.findings if f.stage in mine and f.text.strip()][:20]
            results[pm] = {"verdict": "issues" if finds or out.verdict == "issues" else "ok",
                           "summary": out.summary.strip()[:1500], "findings": finds}
            jobs.set_task(job_id, pm, detail=f"指摘 {len(finds)} 件")

    def fn(row: ProductCycle) -> None:
        rv = dict(row.review)
        rv["rounds"] = [{**r, "pm": results, "status": "ready", "reviewed_at": _now().isoformat()} if r["n"] == rn
                        else r for r in rv["rounds"]]
        row.review = rv
    _update(product.id, fn)
    total = sum(len(r["findings"]) for r in results.values())
    _notify(product, "platform",
            f"【プロダクトレビュー】第 {rn} 回の PM のレビューが出ました（指摘 {total} 件）。内容を確かめ、"
            "直すところがあれば PM に修正を指示してください。問題がなければレビューを完了できます。",
            "プロダクトレビュー", f"/p/{product.id}/review", cycle=c.number, round=rn)


jobs.HANDLERS["product_review"] = run_review


def instruct(product: Product, actor: str, notes: str, directives: dict[str, str]) -> dict:
    """PdM が PM に修正を指示する。PM は担当に Issue を出し、担当がすぐ動いて直す。"""
    from . import agentrun
    from . import issues as iss
    from .team import DOMAIN, PMS, name_of, start

    directives = {k: v.strip()[:4000] for k, v in (directives or {}).items() if k in PMS and v.strip()}
    if not directives:
        raise CycleError(422, "どの PM に何を直させるかを書いてください")
    if state_of(product.id) != REVIEW:
        raise CycleError(409, "プロダクトレビュー中ではありません")
    c = current(product.id)
    rnd = _round(c)
    if rnd is None or rnd["status"] not in ("ready", "fixed"):
        raise CycleError(409, "PM のレビューが出てから指示してください")
    conn = llmconf.resolve(product.tenant_id)
    rs = repo.runs(product.id)
    fixes, wake = [], []
    for pm, text in directives.items():
        mine = [sid for sid in DOMAIN[pm] if sid != RELEASE_STAGE and rs[sid].enabled]
        finds = ((rnd.get("pm") or {}).get(pm) or {}).get("findings", [])
        if conn.provider == "stub":
            llm._record("stub", 0, 0)
            stages = list(dict.fromkeys(f["stage"] for f in finds if f["stage"] in mine)) or mine[:1]
            out = FixOut(issues=[FixIssueOut(stage=sid, subject=f"プロダクトレビューの修正：{text[:60]}",
                                             description=text) for sid in stages])
        else:
            prep = agentrun.prepare(product.tenant_id, product, pm)
            out = agentrun.think(conn, prep, (
                f"あなたはプロダクト「{product.name}」の{name_of(pm)}です。"
                f"プロダクトレビューで PdM から修正の指示が来ました。"
                "担当ごとに、何をどう直すかを Issue にします（stage は " + "・".join(mine) + "。直す工程だけ）。"
                "description には PdM の指示・関係する指摘・完了の条件を書く。期限や時刻は書かない。\n"
                + prep.header() + f"\n\n## PdM の指示\n{text}\n\n## 自分のレビューの指摘\n"
                + "\n".join(f"- [{f['stage']}] {f['text']}（直し方：{f['fix']}）" for f in finds)
            ), FixOut)
        nums = []
        for it in out.issues[:8]:
            if it.stage not in mine:
                continue
            try:
                i = iss.create(product, pm, it.stage, it.subject[:200] or "プロダクトレビューの修正",
                               f"{it.description}\n\n"
                               f"（サイクル {c.number} のプロダクトレビュー 第 {rnd['n']} 回の修正）"
                               "\n直したら resolved にして返してください。",
                               tracker="bug", priority="high", stage_id=it.stage, wake=False)
                nums.append(i["number"])
                wake.append(it.stage)
            except iss.IssueError:
                continue
        fixes.append({"pm": pm, "text": text, "issues": nums})

    def fn(row: ProductCycle) -> None:
        rv = dict(row.review)
        rv["rounds"] = [{**r, "status": "fixing", "notes": notes.strip()[:4000], "fixes": [*r.get("fixes", []), *fixes],
                         "notified": False} if r["n"] == rnd["n"] else r for r in rv["rounds"]]
        row.review = rv
    _update(product.id, fn)
    repo.log(product.id, None, "human", actor, "cycle.review.fix", {"round": rnd["n"], "pms": list(directives)})
    if wake:
        start(product, actor, list(dict.fromkeys(wake)), reason="プロダクトレビューの修正")
    return state(product)


def refresh_review(product: Product) -> None:
    """修正の Issue が全部終わったら、回を「直った」にして PdM に知らせる（1回だけ）。"""
    c = current(product.id)
    rnd = _round(c)
    if not rnd or rnd["status"] != "fixing":
        return
    nums = {n for f in rnd.get("fixes", []) for n in f.get("issues", [])}
    st = _issue_status(product.id, nums)
    if nums and any(v not in DONE_ISSUE for v in st.values()):
        return

    def fn(row: ProductCycle) -> None:
        rv = dict(row.review)
        rv["rounds"] = [{**r, "status": "fixed", "fixed_at": _now().isoformat()} if r["n"] == rnd["n"] else r
                        for r in rv["rounds"]]
        row.review = rv
    _update(product.id, fn)
    _notify(product, "platform",
            f"【プロダクトレビュー】第 {rnd['n']} 回の修正が終わりました。もう一度 PM にレビューさせるか、"
            f"レビューを完了してください。",
            "プロダクトレビュー", f"/p/{product.id}/review", cycle=c.number, round=rnd["n"])


def rereview(product: Product, actor: str) -> dict:
    if state_of(product.id) != REVIEW:
        raise CycleError(409, "プロダクトレビュー中ではありません")
    rnd = _round(current(product.id))
    if rnd and rnd["status"] in ("reviewing", "fixing"):
        raise CycleError(409, "いまの回が終わってから、もう一度レビューさせてください")
    _new_round(product, actor)
    return state(product)


def complete_review(product: Product, actor: str, next_step: str) -> dict:
    """プロダクトレビューを完了する。release ならオンボーディングへ、skip ならリリースせずにサイクルを終える。"""
    if next_step not in ("release", "skip"):
        raise CycleError(422, "次は release（リリースに進む）か skip（リリースしない）です")
    if state_of(product.id) != REVIEW:
        raise CycleError(409, "プロダクトレビュー中ではありません")
    rnd = _round(current(product.id))
    if rnd is None or rnd["status"] in ("reviewing", "fixing"):
        raise CycleError(409, "PM のレビュー・修正が終わってから完了してください")

    def fn(row: ProductCycle) -> None:
        row.review = {**(row.review or {}), "done_at": _now().isoformat(), "done_by": actor, "next": next_step}
    _update(product.id, fn)
    repo.log(product.id, None, "human", actor, "cycle.review.done", {"next": next_step})
    if next_step == "release":
        from . import releases

        _set_state(product.id, ONBOARDING)
        releases.start_onboarding(product, actor)
    else:
        _set_state(product.id, DONE)
    return state(product)


def check_all() -> list[str]:
    """定期実行から呼ぶ：全工程が100%になったプロダクトをレビューに入れる。"""
    with session() as s:
        ps = list(s.execute(select(Product).where(Product.status != "stopped")).scalars())
        for p in ps:
            s.expunge(p)
    out = []
    for p in ps:
        if (p.cycle_state or RUNNING) == REVIEW:
            refresh_review(p)  # 修正が終わったら知らせる
            continue
        if (p.cycle_state or RUNNING) != RUNNING:
            continue
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
        if (p.cycle_state or RUNNING) != DONE:
            raise CycleError(409, f"いまは{STATE_LABEL.get(p.cycle_state, p.cycle_state)}です。"
                f"サイクルが終わってから始めます")
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
            if a.key in STAGE_BY_ID and a.key != RELEASE_STAGE:
                a.report = {**(a.report or {}), "progress": 0, "health": "green",
                            "summary": f"サイクル {n} の目標を待っています", "blockers": [], "next": []}
            if a.key in PMS:
                a.memory = {**(a.memory or {}), "seen": {}}
        s.commit()
    rs = repo.runs(product.id)
    for st in CYCLE_STAGES:
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
    mine = [sid for sid in DOMAIN[pm] if sid != RELEASE_STAGE and rs[sid].enabled]  # ⑭リリースはサイクルの外
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
    for st in CYCLE_STAGES:
        r = rs[st.id]
        if not r.enabled:
            continue
        fw = fwlib.of(product.id, st.id)
        d = repo.draft(product.id, st.id)
        item = {"id": st.id, "no": st.no, "name": st.name, "phase": st.phase, "status": r.status,
                "pct": pr.get(st.id, 0), "version": r.approved_version, "missing": fx.check(fw, d),
                "markdown": fx.to_markdown(st, fw, d), "goal": goal_of(product.id, st.id)}
        if st.id == "s06":
            item["proto"] = ((d.get("ui") or {}).get("proto") or {}).get("html") or ""  # UI のプロトタイプ
        out.append(item)
    return out
