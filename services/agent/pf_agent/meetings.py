"""PdM と PM の振り返りの会議（1日1回。既定は平日 18:00）。

準備（ジョブ meeting）
1. 各 PM のレポート：前回の会議からの、領域の担当の実行状況・起きた課題
   （PM のタスク管理の場所に集めたこと）・Issue の動き
2. PM どうしの突き合わせ：各 PM が他の PM のレポートを読み、自分の領域の担当の状況と、今できている成果物の中身と
   比べて、食い違いがないかを確かめる
準備ができたら会議を開き、PdM は会議の画面でレポートと突き合わせを読み、PM と話す（話した内容は PM との対話に残る）。
"""

from __future__ import annotations

import datetime as dt

from pydantic import BaseModel
from sqlalchemy import select

from . import cron, jobs, llm, llmconf, repo
from . import frameworks as fx
from .db import AgentIssue, DailyMeeting, IssueJournal, JobRun, PmNote, Product, session
from .stages import STAGE_BY_ID
from .team import DOMAIN, KEYS, PMS, TeamError, _iso, name_of

JST = cron.ZoneInfo("Asia/Tokyo")

jobs.JOBS["meeting"] = jobs.JobDef(
    "meeting",
    "振り返りの会議の準備",
    "各 PM が前回からの領域の状況をレポートにまとめ、"
    "他の PM のレポートと自分の領域の成果物を突き合わせて食い違いを探す。",
    "会議の予定（既定は平日 18:00）・「会議を始める」",
    30,
)


class ReportOut(BaseModel):
    health: str  # green | yellow | red
    text: str  # Markdown（実行状況・起きた課題・決めてほしいこと）


class ReviewItem(BaseModel):
    about: str  # 突き合わせた相手の PM（pm_biz など）
    conflict: bool
    text: str


class ReviewOut(BaseModel):
    items: list[ReviewItem]


def meeting_dict(m: DailyMeeting) -> dict:
    return {
        "id": m.id,
        "day": m.day,
        "status": m.status,
        "reports": m.reports or {},
        "reviews": m.reviews or [],
        "job_id": m.job_id,
        "created_at": _iso(m.created_at),
    }


def _jst(t: dt.datetime) -> dt.datetime:
    return (t if t.tzinfo else t.replace(tzinfo=dt.UTC)).astimezone(JST)


def _today() -> str:
    return dt.datetime.now(JST).date().isoformat()


def today(product: Product) -> dict | None:
    with session() as s:
        m = s.execute(
            select(DailyMeeting)
            .where(DailyMeeting.product_id == product.id, DailyMeeting.day == _today())
            .order_by(DailyMeeting.id.desc())
            .limit(1)
        ).scalar_one_or_none()
        return meeting_dict(m) if m else None


def list_meetings(product: Product) -> list[dict]:
    with session() as s:
        return [
            meeting_dict(m)
            for m in s.execute(
                select(DailyMeeting)
                .where(DailyMeeting.product_id == product.id)
                .order_by(DailyMeeting.id.desc())
                .limit(60)
            ).scalars()
        ]


def get(product: Product, mid: int) -> dict:
    from .pms import messages

    with session() as s:
        m = s.get(DailyMeeting, mid)
        if m is None or m.product_id != product.id:
            raise TeamError(404, "会議が見つかりません")
        d = meeting_dict(m)
    d["messages"] = messages(product, meeting_id=mid, limit=200)
    return d


def start(product: Product, user: str, scheduled: bool = False) -> dict:
    """会議の準備を始める（同じ日に開いている会議があれば、それを使う）。"""
    from .team import ensure

    ensure(product)
    with session() as s:
        cur = s.execute(
            select(DailyMeeting).where(
                DailyMeeting.product_id == product.id,
                DailyMeeting.day == _today(),
                DailyMeeting.status.in_(("preparing", "open")),
            )
        ).scalar_one_or_none()
        if cur is not None and (scheduled or cur.status == "preparing"):
            return {**meeting_dict(cur), "job_id": cur.job_id}
        m = DailyMeeting(product_id=product.id, day=_today(), status="preparing")
        s.add(m)
        s.commit()
        mid = m.id
    conn = llmconf.resolve(product.tenant_id)
    job_id = jobs.create(
        "meeting",
        product.tenant_id,
        product.id,
        user,
        {"meeting": mid},
        total=len(PMS) * 2,
        model=conn.summary_model,
        tasks=[
            *({"id": f"report:{p}", "name": f"{name_of(p)}のレポート", "group": "レポート", "deps": []} for p in PMS),
            *(
                {
                    "id": f"review:{p}",
                    "name": f"{name_of(p)}の突き合わせ",
                    "group": "突き合わせ",
                    "deps": [f"report:{x}" for x in PMS],
                }
                for p in PMS
            ),
        ],
    )
    with session() as s:
        s.get(DailyMeeting, mid).job_id = job_id
        s.commit()
    jobs.dispatch(job_id)
    return {**get(product, mid), "job_id": job_id}


def close(product: Product, mid: int) -> dict:
    with session() as s:
        m = s.get(DailyMeeting, mid)
        if m is None or m.product_id != product.id:
            raise TeamError(404, "会議が見つかりません")
        m.status = "closed"
        s.commit()
    return get(product, mid)


def _since(product_id: str, mid: int) -> dt.datetime:
    with session() as s:
        prev = s.execute(
            select(DailyMeeting)
            .where(DailyMeeting.product_id == product_id, DailyMeeting.id < mid)
            .order_by(DailyMeeting.id.desc())
            .limit(1)
        ).scalar_one_or_none()
        return prev.created_at if prev else dt.datetime(2000, 1, 1, tzinfo=dt.UTC)


def _domain_material(product: Product, pm: str, since: dt.datetime, mid: int) -> str:
    from .pms import snapshot

    rs = repo.runs(product.id)
    with session() as s:
        notes = list(
            s.execute(
                select(PmNote)
                .where(PmNote.product_id == product.id, PmNote.pm == pm, PmNote.meeting_id.is_(None))
                .order_by(PmNote.id)
            ).scalars()
        )
        issues = list(
            s.execute(
                select(AgentIssue).where(AgentIssue.product_id == product.id, AgentIssue.updated_at >= since)
            ).scalars()
        )
        issues = [i for i in issues if i.assignee in (pm, *DOMAIN[pm]) or i.author in (pm, *DOMAIN[pm])]
        moved = {
            i.id: [
                j.notes[:300]
                for j in s.execute(
                    select(IssueJournal)
                    .where(IssueJournal.issue_id == i.id, IssueJournal.created_at >= since)
                    .order_by(IssueJournal.id)
                ).scalars()
            ][-3:]
            for i in issues
        }
        for n in notes:
            n.meeting_id = mid
        s.commit()
        note_lines = [
            f"- {_jst(n.created_at):%m/%d %H:%M}［{n.kind}］{name_of(n.agent) if n.agent else ''}：{n.text[:500]}"
            for n in notes
        ]
    return (
        "## 担当の今の状況\n"
        + "\n".join(f"- {k} {name_of(k)}：{snapshot(product.id, k, rs)}" for k in DOMAIN[pm])
        + "\n\n## PM のタスク管理の場所に集めたこと（前回の会議から）\n"
        + ("\n".join(note_lines[-80:]) or "（なし）")
        + "\n\n## Issue の動き（前回の会議から）\n"
        + (
            "\n".join(
                f"- #{i.number}［{i.status}・{i.done_ratio}%］{i.subject}"
                f"（{name_of(i.author) if i.author in KEYS else 'PdM'}"
                f"→{name_of(i.assignee)}）{'／'.join(moved[i.id])}"
                for i in issues
            )
            or "（なし）"
        )
    )


def _deliverables(product: Product, pm: str) -> str:
    out = []
    for k in DOMAIN[pm]:
        st, fw = STAGE_BY_ID[k], fx.FRAMEWORK_BY_STAGE[k]
        out.append(fx.to_markdown(st, fw, repo.draft(product.id, k))[:6000])
    return "\n\n".join(out)


def run(job_id: str) -> None:
    with session() as s:
        j = s.get(JobRun, job_id)
        mid = j.params["meeting"]
        product = s.get(Product, j.product_id)
        s.expunge(product)
    conn = llmconf.resolve(product.tenant_id)
    since = _since(product.id, mid)
    reports: dict[str, dict] = {}
    try:
        for pm in PMS:
            with jobs.task(job_id, f"report:{pm}"):
                material = _domain_material(product, pm, since, mid)
                if conn.provider == "stub":
                    llm._record("stub", 0, 0)
                    out = ReportOut(health="green", text=f"（スタブ）{name_of(pm)}の報告\n\n{material[:1500]}")
                else:
                    out = llm._json(
                        conn,
                        conn.summary_model,
                        (
                            f"あなたはプロダクト「{product.name}」の{name_of(pm)}です。"
                            f"PdM との振り返りの会議に出すレポートを書きます。\n"
                            "Markdown で、見出しは「実行状況」「起きた課題」「PdM に決めてほしいこと」"
                            "「次にやること」。"
                            "担当ごとの実行状況と、起きた課題（Issue の番号つき）を具体的に。資料にないことは書かない。"
                            "health は領域全体として green・yellow・red。\n\n" + material[:80000]
                        ),
                        ReportOut,
                    )
                reports[pm] = {
                    "text": out.text,
                    "health": out.health if out.health in ("green", "yellow", "red") else "yellow",
                    "at": dt.datetime.now(dt.UTC).isoformat(),
                }
                jobs.set_task(job_id, f"report:{pm}", detail=reports[pm]["health"])
        with session() as s:
            s.get(DailyMeeting, mid).reports = reports
            s.commit()
        reviews: list[dict] = []
        for pm in PMS:
            with jobs.task(job_id, f"review:{pm}"):
                others = {p: r["text"] for p, r in reports.items() if p != pm}
                if conn.provider == "stub":
                    llm._record("stub", 0, 0)
                    items = [
                        ReviewItem(about=p, conflict=False, text="（スタブ）食い違いは見つかりませんでした。")
                        for p in others
                    ]
                else:
                    items = llm._json(
                        conn,
                        conn.summary_model,
                        (
                            f"あなたはプロダクト「{product.name}」の{name_of(pm)}です。他の PM のレポートを読み、"
                            "自分の領域の担当の状況と、今できている成果物の中身と突き合わせて、食い違い・抜け・前提のずれがないかを確かめます。\n"
                            "items は他の PM ごとに1つ。about はその PM の key、"
                            "conflict は食い違いがあれば true、text に根拠（どの工程のどの記述か）"
                            "と、どう直すべきかを書く。問題がなければ conflict=false で「食い違いなし」と短く。\n\n"
                            f"## 自分の領域のレポート\n{reports[pm]['text'][:20000]}\n\n"
                            + "".join(f"## {name_of(p)}（{p}）のレポート\n{t[:20000]}\n\n" for p, t in others.items())
                            + f"## 自分の領域の成果物（今の下書き）\n{_deliverables(product, pm)[:60000]}\n"
                        ),
                        ReviewOut,
                    ).items
                for it in items:
                    if it.about in PMS and it.about != pm:
                        reviews.append({"pm": pm, "about": it.about, "conflict": bool(it.conflict), "text": it.text})
                jobs.set_task(job_id, f"review:{pm}", detail=f"食い違い {sum(1 for it in items if it.conflict)} 件")
        with session() as s:
            m = s.get(DailyMeeting, mid)
            m.reviews, m.status = reviews, "open"
            s.commit()
    except Exception:
        with session() as s:
            s.get(DailyMeeting, mid).status = "failed"
            s.commit()
        raise


jobs.HANDLERS["meeting"] = run
