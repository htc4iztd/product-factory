"""エージェントの組織と掲示板。

指揮系統
- PdM（人）：話せるのは PM だけ。意思は PM との対話（いつでも）と、1日1回の振り返りの会議（meetings.py）で伝える
- PM（3人）：事業 PM（①〜⑤）・設計 PM（⑥〜⑪）・実装 PM（⑫〜⑭）。自分の領域のプロジェクト管理をする。
  1時間ごとに領域の担当へ状況確認を出し、集めたことを PM のタスク管理の場所（PmNote）に置き、会議で PdM に伝える
- 各工程の担当：10分ごとに、自分宛てで終わっていない Issue（issues.py）を確かめ、あれば実行計画を立てて実行し、
  結果を Issue に返す（工程の下書きに書き込み、状態・進み具合を更新し、起票した人か確認が要るエージェントに返す）

掲示板（BoardPost）と Issue の使い分け
- 掲示板：プロダクトの進み具合について、他のエージェントに確認が要ることを発信するやり取りの場（エージェント同士だけ。
  PdM は読むだけ）
- Issue：自分と他のエージェントの間で、どちらかが動く必要があることを記録し、状況を管理するもの
各エージェントは PdM に直接話しかけない（掲示板でも Issue でも）。PdM に伝えたいことは自分の領域の PM に上げる。
"""

from __future__ import annotations

import datetime as dt

from pydantic import BaseModel
from sqlalchemy import func, or_, select, update

from . import cron, jobs, llm, llmconf, repo
from . import frameworks as fx
from .db import AgentIssue, BoardPost, IssueJournal, JobRun, PmMessage, PmNote, Product, TeamAgent, session
from .stages import STAGE_BY_ID, STAGES

PMS = ("pm_biz", "pm_design", "pm_impl")
DOMAIN = {
    "pm_biz": ("s01", "s02", "s03", "s04", "s05"),
    "pm_design": ("s06", "s07", "s08", "s09", "s10", "s11"),
    "pm_impl": ("s12", "s13", "s14"),
}
PM_OF = {sid: pm for pm, sids in DOMAIN.items() for sid in sids}
KEYS = (*PMS, *(s.id for s in STAGES))
MEETING = "meeting"  # 会議の予定も TeamAgent の行で持つ（エージェントではない）
INTENTS = ("confirm", "answer", "notice")
INTENT_LABEL = {"confirm": "確認", "answer": "回答", "notice": "共有"}
HEALTH = ("green", "yellow", "red")
MAX_TURNS = 30
DEFAULT_CRON = {"pm": "0 * * * *", "stage": "*/10 * * * *", MEETING: "0 18 * * 1-5"}

jobs.JOBS["team"] = jobs.JobDef(
    "team",
    "エージェントの組織の実行",
    "PM は領域の担当に状況確認を出して集めたことを記録し、各工程の担当は自分宛ての Issue を実行して結果を返す。"
    "Issue を受けた担当は同じジョブの中ですぐ動く。",
    "予定（cron）・Issue の起票・「今すぐ動かす」",
    30,
)


class TeamError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def name_of(key: str) -> str:
    names = {
        "pm_biz": "事業PM",
        "pm_design": "設計PM",
        "pm_impl": "実装PM",
        "platform": "プラットフォーム",
        "pdm": "PdM",
        "all": "全員",
        "director": "司令塔（廃止）",
        "pm": "PM（旧）",
    }
    if key in names:
        return names[key]
    st = STAGE_BY_ID.get(key)
    return f"{st.no}{st.name}担当" if st else key


def domain_label(pm: str) -> str:
    return "・".join(STAGE_BY_ID[s].no for s in DOMAIN[pm])


def default_mission(key: str) -> str:
    if key in PMS:
        stages = "、".join(f"{STAGE_BY_ID[s].no}{STAGE_BY_ID[s].name}" for s in DOMAIN[key])
        return (
            f"{stages}のプロジェクト管理をする。PdM と対話して意思を確かめ、担当への Issue に落とす。"
            "1時間ごとに担当の状況を確かめて記録し、遅れ・止まっていること・工程間の食い違いを見つけて手を打つ。"
            "毎日の振り返りの会議で PdM に報告し、他の PM の報告と自分の領域の成果物を突き合わせる。"
        )
    st = STAGE_BY_ID[key]
    fw = fx.FRAMEWORK_BY_STAGE[key]
    return (
        f"{st.no}{st.name}（{fw.title}）を作り上げる：{fw.summary}。自分宛ての Issue を実行し、結果を Issue に返す。"
        "他の工程に確認が要ることは掲示板で、動いてほしいことは Issue で伝える。PdM に聞きたいことは"
        f"{name_of(PM_OF[key])}に上げる。"
    )


def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def _iso(t: dt.datetime | None) -> str | None:
    if t is None:
        return None
    return (t if t.tzinfo else t.replace(tzinfo=dt.UTC)).isoformat()


# ---------------- 組織 ----------------
def ensure(product: Product) -> None:
    """足りないエージェント（PM 3人・14工程）と会議の予定を置く。"""
    with session() as s:
        have = set(s.execute(select(TeamAgent.key).where(TeamAgent.product_id == product.id)).scalars())
        for k in (*KEYS, MEETING):
            if k in have:
                continue
            c = DEFAULT_CRON["pm"] if k in PMS else DEFAULT_CRON[MEETING] if k == MEETING else DEFAULT_CRON["stage"]
            s.add(
                TeamAgent(
                    tenant_id=product.tenant_id,
                    product_id=product.id,
                    key=k,
                    mission="" if k == MEETING else default_mission(k),
                    cron=c,
                    next_run_at=cron.next_after(c, _now()),
                )
            )
        s.commit()


def agent_dict(a: TeamAgent, open_issues: int = 0, unread: int = 0) -> dict:
    return {
        "key": a.key,
        "name": name_of(a.key),
        "role": "pm" if a.key in PMS else "stage",
        "pm": a.key if a.key in PMS else PM_OF.get(a.key),
        "domain": list(DOMAIN.get(a.key, ())),
        "mission": a.mission,
        "cron": a.cron,
        "cron_label": cron.describe(a.cron),
        "enabled": a.enabled,
        "report": a.report or None,
        "next_run_at": _iso(a.next_run_at),
        "last_run_at": _iso(a.last_run_at),
        "last_job_id": a.last_job_id,
        "runs": a.runs,
        "open_issues": open_issues,
        "unread": unread,
    }


def post_dict(p: BoardPost) -> dict:
    return {
        "id": p.id,
        "thread": p.thread or p.id,
        "title": p.title,
        "sender": p.sender,
        "sender_name": name_of(p.sender),
        "recipient": p.recipient,
        "recipient_name": name_of(p.recipient),
        "intent": p.intent,
        "text": p.text,
        "author": p.author,
        "read": p.read,
        "job_id": p.job_id,
        "created_at": _iso(p.created_at),
    }


OPEN = ("new", "in_progress", "feedback", "resolved")  # 終わっていない（closed・rejected 以外）
ACTIONABLE = ("new", "in_progress", "feedback")  # 担当が手を動かすもの


def overview(product: Product) -> dict:
    ensure(product)
    with session() as s:
        agents = {a.key: a for a in s.execute(select(TeamAgent).where(TeamAgent.product_id == product.id)).scalars()}
        opens = dict(
            s.execute(
                select(AgentIssue.assignee, func.count())
                .where(AgentIssue.product_id == product.id, AgentIssue.status.in_(OPEN))
                .group_by(AgentIssue.assignee)
            ).all()
        )
        unread = dict(
            s.execute(
                select(BoardPost.recipient, func.count())
                .where(BoardPost.product_id == product.id, BoardPost.read.is_(False))
                .group_by(BoardPost.recipient)
            ).all()
        )
        working: set[str] = set()
        for (tasks_,) in s.execute(
            select(JobRun.tasks).where(
                JobRun.product_id == product.id, JobRun.kind == "team", JobRun.status.in_(("queued", "running"))
            )
        ).all():
            working |= {t["id"].split("#")[0] for t in tasks_ or [] if t.get("status") == "running"}
        meeting = agents.get(MEETING)
        out = []
        for k in KEYS:
            a = agents[k]
            d = agent_dict(a, opens.get(k, 0), unread.get(k, 0))
            health = (a.report or {}).get("health")
            d["state"] = "working" if k in working else "stuck" if health == "red" else "idle"
            out.append(d)
        return {
            "agents": out,
            "meeting": {
                "cron": meeting.cron,
                "cron_label": cron.describe(meeting.cron),
                "enabled": meeting.enabled,
                "next_run_at": _iso(meeting.next_run_at),
            },
        }


def edit_agent(product: Product, key: str, mission: str | None, cron_expr: str | None, enabled: bool | None) -> dict:
    ensure(product)
    if key not in (*KEYS, MEETING):
        raise TeamError(404, f"エージェント {key} はいません")
    with session() as s:
        a = _agent(s, product.id, key)
        if mission is not None and key != MEETING:
            a.mission = mission.strip()[:4000] or default_mission(key)
        if cron_expr is not None:
            try:
                a.next_run_at = cron.next_after(cron_expr.strip(), _now(), a.timezone)
            except cron.CronError as e:
                raise TeamError(422, f"cron が読めません：{e}") from None
            a.cron = cron_expr.strip()
        if enabled is not None:
            a.enabled = enabled
        s.commit()
        return agent_dict(a)


def _agent(s, product_id: str, key: str) -> TeamAgent:
    a = s.execute(
        select(TeamAgent).where(TeamAgent.product_id == product_id, TeamAgent.key == key)
    ).scalar_one_or_none()
    if a is None:
        raise TeamError(404, f"エージェント {key} はいません")
    return a


# ---------------- 掲示板（エージェント同士だけ） ----------------
def post(
    product: Product,
    sender: str,
    recipient: str,
    intent: str,
    text: str,
    thread: int | None = None,
    title: str = "",
    author: str = "",
    job_id: str | None = None,
    read: bool = False,
) -> dict:
    if sender not in KEYS or recipient not in (*KEYS, "all"):
        raise TeamError(422, "掲示板はエージェント同士のやり取りの場です（PdM は PM と話してください）")
    intent = intent if intent in INTENTS else "notice"
    with session() as s:
        if thread is not None:
            root = s.get(BoardPost, thread)
            if root is None or root.product_id != product.id:
                thread = None
            else:
                thread = root.thread or root.id
        p = BoardPost(
            tenant_id=product.tenant_id,
            product_id=product.id,
            thread=thread,
            title=title[:300],
            sender=sender,
            recipient=recipient,
            intent=intent,
            text=text.strip()[:8000],
            author=author[:200],
            job_id=job_id,
            read=read,
        )
        s.add(p)
        s.flush()
        if p.thread is None:
            p.thread = p.id
        s.commit()
        return post_dict(p)


def board(
    product: Product,
    agent: str | None = None,
    intent: str | None = None,
    q: str | None = None,
    thread: int | None = None,
    limit: int = 300,
) -> dict:
    """スレッドごとにまとめた掲示板。agent を渡すとその人が送った・受けた投稿のあるスレッドだけ。"""
    with session() as s:
        cond = [BoardPost.product_id == product.id]
        if thread is not None:
            cond.append(BoardPost.thread == thread)
        if agent:
            cond.append(or_(BoardPost.sender == agent, BoardPost.recipient == agent))
        if intent:
            cond.append(BoardPost.intent == intent)
        if q:
            cond.append(or_(BoardPost.text.contains(q), BoardPost.title.contains(q)))
        hits = (
            s.execute(
                select(BoardPost.thread)
                .where(*cond)
                .group_by(BoardPost.thread)
                .order_by(func.max(BoardPost.id).desc())
                .limit(80)
            )
            .scalars()
            .all()
        )
        posts = list(
            s.execute(
                select(BoardPost)
                .where(BoardPost.product_id == product.id, BoardPost.thread.in_(hits))
                .order_by(BoardPost.id)
                .limit(limit)
            ).scalars()
        )
    threads: dict[int, dict] = {}
    for p in posts:
        t = threads.setdefault(p.thread, {"thread": p.thread, "title": p.title, "posts": []})
        t["posts"].append(post_dict(p))
        if not t["title"] and p.title:
            t["title"] = p.title
    out = sorted(threads.values(), key=lambda t: t["posts"][-1]["id"], reverse=True)
    for t in out:
        ps = t["posts"]
        t["title"] = t["title"] or ps[0]["text"][:60]
        t["participants"] = list(dict.fromkeys([x["sender"] for x in ps] + [x["recipient"] for x in ps]))
        t["last_at"] = ps[-1]["created_at"]
    return {"threads": out}


def _context_posts(s, product_id: str, key: str, limit: int = 30) -> list[BoardPost]:
    """そのエージェントが読む投稿：自分宛て・自分が出した・全員宛ての新しいもの。"""
    rows = s.execute(
        select(BoardPost)
        .where(BoardPost.product_id == product_id, or_(BoardPost.recipient.in_([key, "all"]), BoardPost.sender == key))
        .order_by(BoardPost.id.desc())
        .limit(limit)
    ).scalars()
    return list(reversed(list(rows)))


# ---------------- 実行（ジョブ） ----------------
def start(product: Product, user: str, keys: list[str], reason: str = "今すぐ動かす") -> str:
    ensure(product)
    keys = [k for k in KEYS if k in keys]
    if not keys:
        raise TeamError(422, "動かすエージェントを選んでください")
    conn = llmconf.resolve(product.tenant_id)
    job_id = jobs.create(
        "team",
        product.tenant_id,
        product.id,
        user,
        {"keys": keys, "reason": reason},
        total=len(keys),
        model=conn.chat_model,
        tasks=[{"id": k, "name": f"{name_of(k)}が動く", "group": "予定", "deps": []} for k in keys],
    )
    jobs.dispatch(job_id)
    with session() as s:
        for a in s.execute(
            select(TeamAgent).where(TeamAgent.product_id == product.id, TeamAgent.key.in_(keys))
        ).scalars():
            a.last_job_id = job_id
        s.commit()
    return job_id


def _my_actionable(product_id: str, key: str) -> list[AgentIssue]:
    """自分宛てで手を動かすべき Issue：まだ自分が手を付けていないか、自分のあとに誰かが書き足したもの。"""
    with session() as s:
        issues = list(
            s.execute(
                select(AgentIssue)
                .where(
                    AgentIssue.product_id == product_id, AgentIssue.assignee == key, AgentIssue.status.in_(ACTIONABLE)
                )
                .order_by(AgentIssue.number)
            ).scalars()
        )
        out = []
        for i in issues:
            last = s.execute(
                select(IssueJournal).where(IssueJournal.issue_id == i.id).order_by(IssueJournal.id.desc()).limit(1)
            ).scalar_one_or_none()
            if last is None or last.author != key:
                s.expunge(i)
                out.append(i)
        return out


def beat(name: str, detail: str = "") -> None:
    from .db import SystemBeat

    with session() as s:
        b = s.get(SystemBeat, name)
        if b is None:
            b = SystemBeat(name=name)
            s.add(b)
        b.at, b.detail = _now(), detail[:500]
        s.commit()


def beats() -> dict:
    from .db import SystemBeat

    with session() as s:
        return {b.name: {"at": _iso(b.at), "detail": b.detail} for b in s.execute(select(SystemBeat)).scalars()}


def ensure_all() -> None:
    """エージェントがまだ置かれていないプロダクトにも置く（画面を開いていないプロダクトも定期的に動かすため）。"""
    with session() as s:
        have = set(s.execute(select(TeamAgent.product_id).distinct()).scalars())
        products = [
            p for p in s.execute(select(Product).where(Product.status != "stopped")).scalars() if p.id not in have
        ]
        for p in products:
            s.expunge(p)
    for p in products:
        ensure(p)


def reap(now: dt.datetime | None = None) -> int:
    """時間を過ぎても終わらないジョブ（落ちた・固まった）を失敗にして、次の予定が詰まらないようにする。"""
    now = now or _now()
    n = 0
    with session() as s:
        rows = list(
            s.execute(
                select(JobRun.id, JobRun.kind, JobRun.created_at, JobRun.started_at).where(
                    JobRun.status.in_(("queued", "running"))
                )
            ).all()
        )
    for jid, kind, created, started in rows:
        limit = (jobs.JOBS[kind].timeout_min if kind in jobs.JOBS else 60) * 1.5 + 5
        t = started or created
        t = t if t.tzinfo else t.replace(tzinfo=dt.UTC)
        if now - t > dt.timedelta(minutes=limit):
            jobs.finish(jid, "failed", f"時間切れ（{int(limit)} 分を過ぎても終わらなかったので止めました）")
            n += 1
    return n


def tick(now: dt.datetime | None = None) -> list[str]:
    """時刻が来たエージェントを動かす。工程の担当は、手を動かす Issue があるときだけ（なければ AI を呼ばない）。
    会議の時刻が来たら、会議の準備（meetings.py）を始める。二重には動かさない。起動に失敗した予定は、時刻を戻して
    次の呼び出しでやり直す。"""
    now = now or _now()
    ensure_all()
    reaped = reap(now)
    with session() as s:
        due = s.execute(
            select(
                TeamAgent.id,
                TeamAgent.product_id,
                TeamAgent.key,
                TeamAgent.next_run_at,
                TeamAgent.cron,
                TeamAgent.timezone,
            ).where(TeamAgent.enabled.is_(True), TeamAgent.next_run_at.is_not(None), TeamAgent.next_run_at <= now)
        ).all()
    by: dict[str, list[str]] = {}
    claimed: dict[tuple[str, str], tuple[int, dt.datetime]] = {}
    for aid, pid, key, at, expr, tz in due:
        with session() as s:
            try:
                nxt = cron.next_after(expr, now, tz)
            except cron.CronError:
                nxt = None
            ok = s.execute(
                update(TeamAgent).where(TeamAgent.id == aid, TeamAgent.next_run_at == at).values(next_run_at=nxt)
            ).rowcount
            s.commit()
        if ok != 1:
            continue
        if key in STAGE_BY_ID:
            with session() as s:  # 確かめた時刻を残す（Issue がなくても、確認はした）
                a = s.get(TeamAgent, aid)
                a.memory = {**(a.memory or {}), "checked_at": now.isoformat()}
                s.commit()
            if not _my_actionable(pid, key):
                continue
        by.setdefault(pid, []).append(key)
        claimed[(pid, key)] = (aid, at)
    started = []
    failed = 0
    for pid, keys in by.items():
        with session() as s:
            product = s.get(Product, pid)
            if product is None:
                continue
            s.expunge(product)
        try:
            if MEETING in keys:
                from . import meetings

                started.append(meetings.start(product, product.created_by, scheduled=True)["job_id"])
            rest = [k for k in keys if k != MEETING]
            if rest:
                started.append(start(product, product.created_by, rest, reason="予定"))
        except Exception:  # noqa: BLE001  起動できなければ時刻を戻し、次の呼び出しでやり直す
            failed += 1
            with session() as s:
                for k in keys:
                    aid, at = claimed[(pid, k)]
                    s.execute(update(TeamAgent).where(TeamAgent.id == aid).values(next_run_at=at))
                s.commit()
            continue
    beat("tick", f"起動 {len(started)}・失敗してやり直し {failed}・時間切れで止めた {reaped}")
    return started


# ----- AI の出力の形 -----
class ReportOut(BaseModel):
    health: str
    progress: int
    summary: str
    blockers: list[str]
    next: list[str]


class IssueUpdateOut(BaseModel):
    number: int
    notes: str  # 何をしたか・結果（実行計画と結果）
    status: str  # new | in_progress | resolved | feedback | closed | rejected
    done_ratio: int
    assign_to: str  # 返す相手（起票したエージェントか確認が要るエージェント。PM まで）。そのままなら空


class NewIssueOut(BaseModel):
    assignee: str
    tracker: str
    subject: str
    description: str
    priority: str


class ChangeOut(BaseModel):
    field: str
    value: str
    reason: str


class PostOut(BaseModel):
    to: str
    intent: str  # confirm（確認）| answer（回答）| notice（共有）
    text: str
    thread: int


class TurnOut(BaseModel):
    report: ReportOut
    issue_updates: list[IssueUpdateOut]
    changes: list[ChangeOut]
    new_issues: list[NewIssueOut]
    posts: list[PostOut]


def _issue_brief(i: AgentIssue, journals: list[IssueJournal]) -> str:
    j = "\n".join(
        f"    - {x.created_at:%m/%d %H:%M} {name_of(x.author) if x.author in KEYS else 'PdM'}：{x.notes[:400]}"
        for x in journals[-6:]
        if x.notes
    )
    return (
        f"- #{i.number}［{i.tracker}・{i.status}・{i.priority}・{i.done_ratio}%］{i.subject}"
        f"（起票：{name_of(i.author) if i.author in KEYS else 'PdM'}）\n  {i.description[:1500]}"
        + (f"\n{j}" if j else "")
    )


def _issues_md(product: Product, issues: list[AgentIssue]) -> str:
    """実行する Issue（これは仕事の入力なので、ツールではなく毎回渡す）。"""
    with session() as s:
        journals = {
            i.id: list(
                s.execute(select(IssueJournal).where(IssueJournal.issue_id == i.id).order_by(IssueJournal.id)).scalars()
            )
            for i in issues
        }
    return "\n".join(_issue_brief(i, journals[i.id]) for i in issues)


# 書くツールごとの、最後の出力の欄の決まり（形はコードで固定。いつ・何を書くかはスキルが決める）
OUTPUT_RULES = {
    "set_field": "changes：自分の工程の項目に書く値（field は項目の key、value は型に合わせた値、reason は理由）。",
    "issue_update": "issue_updates：Issue ごとに notes（計画・やったこと・残ったこと）、status、done_ratio、"
    "assign_to（返す相手。そのままなら空。PdM は宛先にできない）。",
    "issue_create": "new_issues：他のエージェントに動いてもらうことだけ"
    "（assignee・tracker・subject・description・priority）。",
    "board_post": "posts：掲示板（to・intent は confirm/answer/notice・text・thread は返信先の番号か 0）。",
}


def turn_schema(writes: list[str]) -> type[BaseModel]:
    """割り当てた書くツールの欄だけを持つ出力の形。"""
    from pydantic import create_model

    cols = {"set_field": ("changes", list[ChangeOut]), "issue_update": ("issue_updates", list[IssueUpdateOut]),
            "issue_create": ("new_issues", list[NewIssueOut]), "board_post": ("posts", list[PostOut])}
    fields = {"report": (ReportOut, ...)}
    for w in writes:
        if w in cols:
            name, typ = cols[w]
            fields[name] = (typ, ...)
    return create_model("TurnOut", **fields)


def _prompt(product: Product, key: str, mission: str, header: str, issues_md: str, writes: list[str]) -> str:
    pm = PM_OF[key]
    return (
        f"プロダクト「{product.name}」（{product.idea}）の「{name_of(key)}」として、自分宛ての Issue を実行します。"
        f"PdM には直接話しかけず、聞きたいことは {pm}（{name_of(pm)}）に返します。\n"
        f"## 使命（このプロダクトで）\n{mission}\n\n{header}\n\n"
        f"## 自分宛ての Issue（これを実行する）\n{issues_md}\n\n"
        "## 最後の出力\n"
        "- report：health は green・yellow・red、progress は 0〜100、summary は2文、blockers と next は短く。\n"
        + "".join(f"- {OUTPUT_RULES[w]}\n" for w in writes if w in OUTPUT_RULES)
        + "割り当てられていない欄はありません。資料にない数値や事実を作らない。\n"
    )


def _stub_turn(product: Product, key: str, issues: list[AgentIssue], writes: list[str] | None = None) -> BaseModel:
    writes = list(writes if writes is not None else ("set_field", "issue_update", "issue_create", "board_post"))
    fw = fx.FRAMEWORK_BY_STAGE[key]
    d = repo.draft(product.id, key)
    empty = [f for f in fw.fields if not fx.is_filled(f, d.get(f.key))]
    changes = [
        ChangeOut(field=f.key, value=str(llm._stub_value(f, product.idea)), reason="Issue に沿って仮置き（スタブ）")
        for f in empty
    ]
    if "set_field" not in writes:
        changes = []
    total = len([f for f in fw.fields if f.required]) or 1
    full = TurnOut(
        report=ReportOut(
            health="green",
            progress=100 if total else 0,
            summary=f"（スタブ）Issue {len(issues)} 件を実行しました。",
            blockers=[],
            next=[],
        ),
        issue_updates=[
            IssueUpdateOut(
                number=i.number,
                notes=f"（スタブ）計画：必須の項目を埋める。結果：{len(changes)} 項目を書き込みました。",
                status="resolved",
                done_ratio=100,
                assign_to=i.author if i.author in KEYS and i.author != key else "",
            )
            for i in issues
        ],
        changes=changes,
        new_issues=[],
        posts=[
            PostOut(
                to=x.id,
                intent="notice",
                text=f"（スタブ）{STAGE_BY_ID[key].name}を更新しました。影響があれば確認してください。",
                thread=0,
            )
            for x in STAGES
            if key in x.inputs
        ][:1],
    )
    schema = turn_schema(writes)
    return schema(**{k: getattr(full, k) for k in schema.model_fields})


def _apply(product: Product, key: str, out: BaseModel, job_id: str, model: str) -> list[str]:
    """出力を反映する。返り値は、この実行で Issue を受けた（すぐ動かす）エージェント。"""
    from . import issues as iss

    rep = out.report.model_dump()
    rep["health"] = rep["health"] if rep["health"] in HEALTH else "yellow"
    rep["progress"] = max(0, min(100, int(rep["progress"])))
    rep["at"] = _now().isoformat()
    with session() as s:
        a = _agent(s, product.id, key)
        a.report, a.last_run_at, a.runs = rep, _now(), a.runs + 1
        for p in s.execute(
            select(BoardPost).where(
                BoardPost.product_id == product.id, BoardPost.recipient == key, BoardPost.read.is_(False)
            )
        ).scalars():
            p.read = True
        s.commit()
    # 工程の下書きに書き込む（どの項目を変えたかは Issue の記録と監査ログに残る）
    changed = []
    fw = fx.FRAMEWORK_BY_STAGE[key]
    for c in getattr(out, "changes", [])[:12]:
        f = fw.get(c.field)
        if f is None:
            continue
        try:
            repo.set_field(product.id, key, f.key, c.value, name_of(key), "agent")
            changed.append(f.label)
        except (ValueError, TypeError, KeyError):
            continue
    wake: list[str] = []
    for u in getattr(out, "issue_updates", [])[:10]:
        try:
            notes = u.notes + (f"\n（工程の下書きに書き込んだ項目：{'、'.join(changed)}）" if changed else "")
            iss.update(
                product,
                key,
                u.number,
                notes=notes,
                status=u.status,
                done_ratio=u.done_ratio,
                assignee=u.assign_to or None,
                wake=False,
            )
            if u.assign_to and u.assign_to in KEYS and u.assign_to != key:
                wake.append(u.assign_to)
        except iss.IssueError:
            continue
    for n in getattr(out, "new_issues", [])[:5]:
        try:
            i = iss.create(
                product,
                key,
                n.assignee,
                n.subject,
                n.description,
                tracker=n.tracker,
                priority=n.priority,
                stage_id=key,
                wake=False,
            )
            wake.append(i["assignee"])
        except iss.IssueError:
            continue
    for p in getattr(out, "posts", [])[:6]:
        if p.to == key or p.to not in (*KEYS, "all") or not p.text.strip():
            continue
        post(product, key, p.to, p.intent, p.text, p.thread or None, author=model, job_id=job_id)
    return wake


def run(job_id: str) -> None:
    with session() as s:
        j = s.get(JobRun, job_id)
        product = s.get(Product, j.product_id)
        s.expunge(product)
        queue = list(j.params["keys"])
    conn = llmconf.resolve(product.tenant_id)
    done: list[str] = []
    turns = 0
    from . import pms

    while queue and turns < MAX_TURNS:
        key = queue.pop(0)
        tid = key if key not in done else f"{key}#{done.count(key) + 1}"
        if tid not in [t["id"] for t in jobs.run_dict(job_id)["tasks"]]:
            jobs.define_tasks(
                job_id,
                [
                    {
                        "id": tid,
                        "name": f"{name_of(key)}が動く（Issue を受けて）",
                        "group": "Issue",
                        "deps": [done[-1]] if done else [],
                    }
                ],
            )
        jobs.step(job_id, f"{name_of(key)}が動いています", advance=False)
        if key in PMS:
            with jobs.task(job_id, tid):
                wake, detail = pms.check(product, key, job_id, conn)
                jobs.set_task(job_id, tid, detail=detail)
        else:
            issues = _my_actionable(product.id, key)
            if not issues:
                jobs.skip_task(job_id, tid, "手を動かす Issue がない")
                done.append(key)
                continue
            with session() as s:
                mission = _agent(s, product.id, key).mission
            with jobs.task(job_id, tid):
                from . import agentrun

                prep = agentrun.prepare(product.tenant_id, product, key)
                if conn.provider == "stub":
                    llm._record("stub", 0, 0)
                    out = _stub_turn(product, key, issues, prep.lo.writes)
                else:
                    prompt = _prompt(product, key, mission, prep.header(), _issues_md(product, issues), prep.lo.writes)
                    out = agentrun.think(conn, prep, prompt, turn_schema(prep.lo.writes))
                wake = _apply(product, key, out, job_id, conn.chat_model)
                jobs.set_task(
                    job_id,
                    tid,
                    detail=f"Issue {len(issues)} 件・書き込み {len(getattr(out, 'changes', []))} 項目"
                    + (f"・{'、'.join(name_of(w) for w in dict.fromkeys(wake))}へ" if wake else "")
                    + f"／{prep.summary()}",
                )
        turns += 1
        done.append(key)
        for w in dict.fromkeys(wake):
            if w not in queue and done.count(w) < 3:
                queue.append(w)
    if queue:
        jobs.step(
            job_id, f"1回の実行の上限（{MAX_TURNS} 手）に達しました。残り：{'、'.join(name_of(k) for k in queue)}"
        )


jobs.HANDLERS["team"] = run


# ---------------- 画面向け ----------------
def stage_context(product_id: str, stage_id: str) -> str:
    """工程の画面の対話（古い形）でも、担当の使命と Issue を前提にする。"""
    with session() as s:
        a = s.execute(
            select(TeamAgent).where(TeamAgent.product_id == product_id, TeamAgent.key == stage_id)
        ).scalar_one_or_none()
        if a is None:
            return ""
        opens = list(
            s.execute(
                select(AgentIssue).where(
                    AgentIssue.product_id == product_id, AgentIssue.assignee == stage_id, AgentIssue.status.in_(OPEN)
                )
            ).scalars()
        )
        return "\n".join(
            [
                f"あなたは{name_of(stage_id)}。使命：{a.mission}",
                *(f"- Issue #{i.number}［{i.status}］{i.subject}" for i in opens),
            ]
        )


def member(product: Product, key: str) -> dict | None:
    """1人のエージェント（工程の画面に出す）。"""
    ensure(product)
    with session() as s:
        a = s.execute(
            select(TeamAgent).where(TeamAgent.product_id == product.id, TeamAgent.key == key)
        ).scalar_one_or_none()
        if a is None:
            return None
        n = s.execute(
            select(func.count()).where(
                AgentIssue.product_id == product.id, AgentIssue.assignee == key, AgentIssue.status.in_(OPEN)
            )
        ).scalar()
        d = agent_dict(a, n)
    from .avatars import versions  # 接続を1本ずつ使う（上の session を閉じてから）

    return {**d, "avatar_v": versions(product.tenant_id).get(key, "0")}


def mark_read_from(product_id: str, key: str) -> None:  # 古い形の対話との互換（いまは何もしない）
    return None


def dashboard(product: Product) -> dict:
    """ダッシュボード：各エージェントの報告・各案（PP-n）・最近のやり取り（掲示板と Issue）・
    PM から PdM へ・今日の会議。"""
    from . import meetings
    from .avatars import versions as avatar_versions
    from .db import AgentFinding, Variant

    since = _now() - dt.timedelta(days=7)
    with session() as s:
        vs = list(s.execute(select(Variant).where(Variant.product_id == product.id).order_by(Variant.number)).scalars())
        variants = [
            {
                "number": v.number,
                "key": f"PP-{v.number}",
                "title": v.title,
                "status": v.status,
                "stages": sorted((v.drafts or {}).keys()),
            }
            for v in vs
            if v.status != "failed"
        ]
        recent = list(
            s.execute(
                select(BoardPost).where(BoardPost.product_id == product.id, BoardPost.created_at >= since)
            ).scalars()
        )
        open_issues = list(
            s.execute(
                select(AgentIssue).where(AgentIssue.product_id == product.id, AgentIssue.status.in_(OPEN))
            ).scalars()
        )
        from_pm = list(
            s.execute(
                select(PmMessage)
                .where(PmMessage.product_id == product.id, PmMessage.role == "pm", PmMessage.meeting_id.is_(None))
                .order_by(PmMessage.id.desc())
                .limit(8)
            ).scalars()
        )
        findings = s.execute(
            select(func.count()).where(AgentFinding.product_id == product.id, AgentFinding.status == "open")
        ).scalar()
        running = s.execute(
            select(JobRun.id).where(
                JobRun.product_id == product.id,
                JobRun.kind.in_(("team", "meeting")),
                JobRun.status.in_(("queued", "running")),
            )
        ).first()
        notes = s.execute(
            select(func.count()).where(PmNote.product_id == product.id, PmNote.meeting_id.is_(None))
        ).scalar()
    edges: dict[tuple[str, str], dict] = {}
    for p in recent:
        if p.sender not in KEYS or p.recipient not in KEYS:
            continue
        e = edges.setdefault(
            (p.sender, p.recipient), {"source": p.sender, "target": p.recipient, "count": 0, "issues": 0}
        )
        e["count"] += 1
        e["last"] = {"intent": p.intent, "text": p.text[:140], "at": _iso(p.created_at), "thread": p.thread}
    for i in open_issues:
        if i.author in KEYS and i.assignee in KEYS and i.author != i.assignee:
            e = edges.setdefault(
                (i.author, i.assignee), {"source": i.author, "target": i.assignee, "count": 0, "issues": 0}
            )
            e["issues"] += 1
            e.setdefault(
                "last", {"intent": "issue", "text": f"#{i.number} {i.subject}", "at": _iso(i.updated_at), "thread": 0}
            )
    from .pms import message_dict

    return {
        **overview(product),
        "variants": variants,
        "edges": list(edges.values()),
        "from_pm": [message_dict(m) for m in from_pm],
        "findings_open": findings,
        "running": running is not None,
        "pending_notes": notes,
        "meeting_today": meetings.today(product),
        "avatar_versions": avatar_versions(product.tenant_id),
    }
