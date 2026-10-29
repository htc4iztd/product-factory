"""エージェントの組織（三層）と掲示板。

- 司令塔（director）：PdM と一蓮托生。毎日 PdM との対話の時間を用意し（今日の議題）、対話で戦略が決まったら
  「決定」として掲示板に残し、PM に話しかけて動かす。司令塔は自分では決めない（決めるのは PdM との対話）
- PM（pm）：横ぐし。各工程の報告とタスクを見て、遅れ・依存・食い違いを見つけ、担当に依頼する
- 各工程の担当（s01〜s14）：自分の工程の実作業。報告・タスクの洗い出しと最新化・PdM への質問と直し案・
  他の担当への連絡

やり取りはすべて掲示板（BoardPost）に残す。A2A のメッセージと同じ形（送り手・宛先・目的・スレッド・既読）で持ち、
各エージェントは動く前に「自分宛て・自分に関係する」投稿を読む。PdM は掲示板を追い、返信や追加の指示を出せる。
依頼・指示を受けたエージェントはすぐ動く（1回のジョブで往復は MAX_TURNS まで）。
"""

from __future__ import annotations

import datetime as dt
import json
import uuid

from pydantic import BaseModel
from sqlalchemy import func, or_, select

from . import cron, jobs, llm, llmconf, repo
from . import frameworks as fx
from .db import AgentTask, BoardPost, JobRun, Product, TeamAgent, session
from .stages import COMPLETED, NOT_STARTED, STAGE_BY_ID, STAGES

ROLES = ("director", "pm")
INTENTS = ("report", "request", "answer", "decision", "directive", "question")
TASK_STATES = ("todo", "doing", "blocked", "done")
HEALTH = ("green", "yellow", "red")
MAX_TURNS = 24
DEFAULT_CRON = {"director": "30 8 * * 1-5", "pm": "0 9 * * 1-5", "stage": "30 9 * * 1-5"}

jobs.JOBS["team"] = jobs.JobDef(
    "team",
    "エージェントの組織の実行",
    "司令塔 → PM → 各工程の担当の順に動き、報告・タスク・掲示板への投稿・PdM への質問と直し案を更新する。"
    "依頼や指示を受けた担当は同じジョブの中ですぐ動く。",
    "予定（cron）・PdM の指示・「今すぐ動かす」",
    30,
)


class TeamError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def name_of(key: str) -> str:
    if key == "director":
        return "司令塔"
    if key == "pm":
        return "PM"
    if key == "pdm":
        return "PdM"
    if key == "all":
        return "全員"
    st = STAGE_BY_ID.get(key)
    return f"{st.no}{st.name}担当" if st else key


def default_mission(key: str) -> str:
    if key == "director":
        return (
            "PdM と一蓮托生で、プロダクトの戦略を決める。毎日 PdM との対話の時間に、状況・決めるべきこと・論点を出す。"
            "決めたことは PM に伝え、優先順位として各担当に行き渡らせる。自分だけでは決めない。"
        )
    if key == "pm":
        return (
            "全工程を横ぐしで見る。各担当の報告とタスクから、遅れ・工程間の依存・食い違いを見つけ、"
            "担当に依頼して解消する。司令塔の決定と優先順位を、担当ごとの具体的な依頼に落とす。"
        )
    st = STAGE_BY_ID[key]
    fw = fx.FRAMEWORK_BY_STAGE[key]
    return (
        f"{st.no}{st.name}（{fw.title}）を作り上げる：{fw.summary}。"
        "PdM との対話で意思を確かめ、上流の変化を取り込み、下流に影響することは担当に知らせる。"
    )


def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def _iso(t: dt.datetime | None) -> str | None:
    if t is None:
        return None
    return (t if t.tzinfo else t.replace(tzinfo=dt.UTC)).isoformat()


# ---------------- 組織 ----------------
def ensure(product: Product) -> None:
    """足りないエージェントを置く（司令塔・PM・14工程）。"""
    keys = [*ROLES, *(s.id for s in STAGES)]
    with session() as s:
        have = set(s.execute(select(TeamAgent.key).where(TeamAgent.product_id == product.id)).scalars())
        for k in keys:
            if k in have:
                continue
            c = DEFAULT_CRON.get(k, DEFAULT_CRON["stage"])
            s.add(
                TeamAgent(
                    tenant_id=product.tenant_id,
                    product_id=product.id,
                    key=k,
                    mission=default_mission(k),
                    cron=c,
                    next_run_at=cron.next_after(c, _now()),
                )
            )
        s.commit()


def agent_dict(a: TeamAgent, open_tasks: int = 0, unread: int = 0) -> dict:
    return {
        "key": a.key,
        "name": name_of(a.key),
        "role": a.key if a.key in ROLES else "stage",
        "mission": a.mission,
        "cron": a.cron,
        "cron_label": cron.describe(a.cron),
        "enabled": a.enabled,
        "report": a.report or None,
        "memory": a.memory or {},
        "next_run_at": _iso(a.next_run_at),
        "last_run_at": _iso(a.last_run_at),
        "last_job_id": a.last_job_id,
        "runs": a.runs,
        "open_tasks": open_tasks,
        "unread": unread,
    }


def task_dict(t: AgentTask) -> dict:
    return {
        "number": t.number,
        "key": f"TS-{t.number}",
        "agent": t.agent,
        "agent_name": name_of(t.agent),
        "title": t.title,
        "detail": t.detail,
        "status": t.status,
        "owner": t.owner,
        "created_by": t.created_by,
        "created_at": _iso(t.created_at),
        "updated_at": _iso(t.updated_at),
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


def overview(product: Product) -> dict:
    ensure(product)
    with session() as s:
        agents = list(s.execute(select(TeamAgent).where(TeamAgent.product_id == product.id)).scalars())
        opens = dict(
            s.execute(
                select(AgentTask.agent, func.count())
                .where(AgentTask.product_id == product.id, AgentTask.status != "done")
                .group_by(AgentTask.agent)
            ).all()
        )
        unread = dict(
            s.execute(
                select(BoardPost.recipient, func.count())
                .where(BoardPost.product_id == product.id, BoardPost.read.is_(False))
                .group_by(BoardPost.recipient)
            ).all()
        )
        order = {k: i for i, k in enumerate([*ROLES, *(x.id for x in STAGES)])}
        agents.sort(key=lambda a: order.get(a.key, 99))
        return {
            "agents": [agent_dict(a, opens.get(a.key, 0), unread.get(a.key, 0)) for a in agents],
            "pdm_unread": unread.get("pdm", 0),
        }


def edit_agent(product: Product, key: str, mission: str | None, cron_expr: str | None, enabled: bool | None) -> dict:
    ensure(product)
    with session() as s:
        a = _agent(s, product.id, key)
        if mission is not None:
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


# ---------------- 掲示板 ----------------
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
) -> dict:
    if intent not in INTENTS:
        intent = "report"
    with session() as s:
        if thread is not None:
            root = s.get(BoardPost, thread)
            if root is None or root.product_id != product.id:
                raise TeamError(404, "スレッドが見つかりません")
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
        )
        s.add(p)
        s.flush()
        if p.thread is None:
            p.thread = p.id
        elif sender == "pdm":
            # PdM がスレッドに書いたら、そのスレッドの PdM 宛ては読んだことにする
            for x in s.execute(
                select(BoardPost).where(
                    BoardPost.thread == p.thread, BoardPost.recipient == "pdm", BoardPost.read.is_(False)
                )
            ).scalars():
                x.read = True
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
    return list(
        reversed(
            list(
                s.execute(
                    select(BoardPost)
                    .where(
                        BoardPost.product_id == product_id,
                        or_(BoardPost.recipient.in_([key, "all"]), BoardPost.sender == key),
                    )
                    .order_by(BoardPost.id.desc())
                    .limit(limit)
                ).scalars()
            )
        )
    )


def pdm_post(
    product: Product, user: str, recipient: str, text: str, thread: int | None = None, intent: str = "directive"
) -> dict:
    """PdM が掲示板に書く（返信・追加の指示）。司令塔宛ては対話として答え、他はすぐ動かす。"""
    if not text.strip():
        raise TeamError(422, "本文が空です")
    if recipient != "all" and recipient not in [*ROLES, *STAGE_BY_ID]:
        raise TeamError(422, f"宛先 {recipient} がいません")
    ensure(product)
    if recipient == "director":
        return director_talk(product, user, text, thread)
    p = post(product, "pdm", recipient, intent if intent in INTENTS else "directive", text, thread, author=user)
    keys = [k for k in [*ROLES[1:], *STAGE_BY_ID] if recipient in (k, "all")]
    job = start(product, user, keys, reason=f"PdM からの{'指示' if intent == 'directive' else '投稿'}")
    return {**p, "job_id": job}


# ---------------- タスク ----------------
def tasks(product: Product, agent: str | None = None, open_only: bool = False) -> list[dict]:
    with session() as s:
        cond = [AgentTask.product_id == product.id]
        if agent:
            cond.append(AgentTask.agent == agent)
        if open_only:
            cond.append(AgentTask.status != "done")
        return [task_dict(t) for t in s.execute(select(AgentTask).where(*cond).order_by(AgentTask.number)).scalars()]


def upsert_task(
    product: Product,
    actor: str,
    agent: str,
    number: int | None,
    title: str | None,
    status: str | None = None,
    detail: str | None = None,
    owner: str | None = None,
) -> dict:
    with session() as s:
        if number:
            t = s.execute(
                select(AgentTask).where(AgentTask.product_id == product.id, AgentTask.number == number)
            ).scalar_one_or_none()
            if t is None:
                raise TeamError(404, f"TS-{number} はありません")
        else:
            if not (title or "").strip():
                raise TeamError(422, "タスクの名前が空です")
            n = (
                s.execute(select(func.max(AgentTask.number)).where(AgentTask.product_id == product.id)).scalar() or 0
            ) + 1
            t = AgentTask(product_id=product.id, number=n, agent=agent, title="", created_by=actor)
            s.add(t)
        if title is not None and title.strip():
            t.title = title.strip()[:300]
        if detail is not None:
            t.detail = detail[:4000]
        if status in TASK_STATES:
            t.status = status
        if owner in ("agent", "pdm"):
            t.owner = owner
        s.commit()
        return task_dict(t)


# ---------------- 1回の実行（ジョブ） ----------------
def start(product: Product, user: str, keys: list[str], reason: str = "今すぐ動かす") -> str:
    ensure(product)
    keys = [k for k in [*ROLES, *(s.id for s in STAGES)] if k in keys]  # 司令塔 → PM → 工程の順
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


def tick(now: dt.datetime | None = None) -> list[str]:
    """時刻が来たエージェントを、プロダクトごとに1つのジョブで動かす（二重には動かさない）。"""
    from sqlalchemy import update

    now = now or _now()
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
        if ok == 1:
            by.setdefault(pid, []).append(key)
    started = []
    for pid, keys in by.items():
        with session() as s:
            product = s.get(Product, pid)
            if product is None:
                continue
            s.expunge(product)
        try:
            started.append(start(product, product.created_by, keys, reason="予定"))
        except Exception:  # noqa: BLE001, S112  1つのプロダクトの失敗で他を止めない
            continue
    return started


# ----- AI の出力の形 -----
class ReportOut(BaseModel):
    health: str
    progress: int
    summary: str
    blockers: list[str]
    next: list[str]


class TaskOut(BaseModel):
    number: int  # 既存のタスクを更新するときはその番号、新しいタスクは 0
    title: str
    status: str
    owner: str
    detail: str


class PostOut(BaseModel):
    to: str  # director | pm | s01… | pdm | all
    intent: str
    text: str
    thread: int  # 返信するスレッドの番号（新しい話題は 0）


class PropOut(BaseModel):
    field: str
    value: str
    reason: str


class TurnOut(BaseModel):
    report: ReportOut
    tasks: list[TaskOut]
    posts: list[PostOut]
    ask_pdm: str
    proposals: list[PropOut]


def _material(product: Product, key: str, rs: dict) -> str:
    """動くエージェントが読むもの。工程の担当は自分の工程と上流、司令塔・PM は全員の報告。"""
    with session() as s:
        agents = list(s.execute(select(TeamAgent).where(TeamAgent.product_id == product.id)).scalars())
        director = next((a for a in agents if a.key == "director"), None)
        posts = _context_posts(s, product.id, key)
        my_tasks = [
            task_dict(t)
            for t in s.execute(
                select(AgentTask).where(
                    AgentTask.product_id == product.id, AgentTask.agent == key, AgentTask.status != "done"
                )
            ).scalars()
        ]
    strat = (director.memory or {}) if director else {}
    parts = [
        f"## 戦略（PdM と司令塔で決めたこと）\n{json.dumps(strat, ensure_ascii=False) if strat else '（まだない）'}"
    ]
    if key in STAGE_BY_ID:
        st, fw = STAGE_BY_ID[key], fx.FRAMEWORK_BY_STAGE[key]
        d = repo.draft(product.id, key)
        miss = fx.check(fw, d)
        parts.append(
            f"## 自分の工程（状態：{rs[key].status}、版 v{rs[key].current_version}）"
            + (f"\n必須が空：{'、'.join(miss)}" if miss else "")
            + "\n"
            + fx.to_markdown(st, fw, d)[:20000]
        )
        ups = repo.confirmed_artifacts(product.id, st.inputs)
        if ups:
            parts.append("## 上流の最新版\n" + "\n\n".join(f"### {k}\n{v[:6000]}" for k, v in ups.items()))
        parts.append("## 下流の工程\n" + "、".join(f"{x.id}={x.no}{x.name}" for x in STAGES if key in x.inputs))
    else:
        rows = []
        for a in agents:
            if a.key in STAGE_BY_ID:
                r = rs.get(a.key)
                rep = a.report or {}
                rows.append(
                    f"- {a.key} {name_of(a.key)}：状態 {r.status if r else '-'}"
                    f"{'（閉じている）' if r is not None and not r.enabled else ''}・"
                    f"{rep.get('health', '未報告')}・{rep.get('progress', '-')}%・{rep.get('summary', '')[:200]}"
                    + (f"・障害：{'／'.join(rep.get('blockers') or [])}" if rep.get("blockers") else "")
                )
        parts.append("## 各工程の担当の報告\n" + "\n".join(rows))
    parts.append(
        "## 自分の未完了タスク\n"
        + ("\n".join(f"- TS-{t['number']}［{t['status']}］{t['title']}" for t in my_tasks) or "（なし）")
    )
    parts.append(
        "## 掲示板（自分宛て・自分の投稿・全員宛て。古い順。[スレッド番号]）\n"
        + (
            "\n".join(
                f"[{p.thread}] {_iso(p.created_at)[:16]} {name_of(p.sender)}→{name_of(p.recipient)}"
                f"（{p.intent}{'・未読' if not p.read and p.recipient in (key, 'all') else ''}）：{p.text[:600]}"
                for p in posts
            )
            or "（なし）"
        )
    )
    return "\n\n".join(parts)


def _prompt(product: Product, key: str, mission: str, material: str) -> str:
    role = (
        "あなたは司令塔です。PdM と一蓮托生で、決めるのは PdM との対話。今日 PdM と話すべき議題"
        "（状況・決めるべきこと・論点と選択肢）を ask_pdm に書く。決まった戦略を PM に伝える必要があれば"
        "posts で PM に directive を出す。工程の担当に直接指示はしない（PM を通す）。"
        if key == "director"
        else "あなたは PM です。各担当の報告とタスクから、遅れ・工程間の依存・食い違いを見つけ、担当に request を出す。"
        "司令塔の決定・優先順位を担当ごとの具体的な依頼に落とす。PdM に決めてほしいことは司令塔に上げる。"
        if key == "pm"
        else "あなたはこの工程の担当です。自分の工程を作り上げる。PdM に確かめたいことは ask_pdm に1つだけ具体的に。"
        "項目をこう直すべきと具体的に言えるときだけ proposals（field は項目の key）。"
        "他の工程に影響すること・他の工程に頼みたいことは posts でその担当か PM に出す。"
    )
    fields = ""
    if key in STAGE_BY_ID:
        fw = fx.FRAMEWORK_BY_STAGE[key]
        fields = f"\n## 自分の工程の項目\n{json.dumps(fx.spec(fw), ensure_ascii=False)[:8000]}\n" + llm.value_rules(fw)
    return (
        f"プロダクト「{product.name}」（{product.idea}）のエージェント組織の一員「{name_of(key)}」として動きます。\n"
        f"## 使命\n{mission}\n\n## 役割\n{role}\n\n"
        "## 出し方\n"
        "- report：health は green（順調）・yellow（注意）・red（止まっている）、progress は 0〜100、"
        "summary は今の状況を2文、blockers と next は短く。\n"
        "- tasks：自分のタスクを洗い出し、既存のものは number で状態を更新（todo・doing・blocked・done）。"
        "PdM にやってもらうタスクは owner=pdm。同じ内容のタスクを重複して作らない。\n"
        "- posts：未読の依頼・指示・質問には answer で答える（thread にそのスレッド番号）。必要な連絡だけを出し、"
        "挨拶や同じ内容の繰り返しはしない。宛先は director・pm・s01〜s14・all。\n"
        "- ask_pdm：PdM に聞くことがなければ空。\n"
        "- 資料にない数値や事実を作らない。決まっていないことは決まっていないと書く。\n"
        f"{fields}\n## 読むもの\n{material[:120000]}\n"
    )


def _stub_turn(product: Product, key: str, rs: dict, unread: list[BoardPost]) -> TurnOut:
    posts = [
        PostOut(
            to=p.sender if p.sender != "pdm" else "pdm",
            intent="answer",
            text=f"（スタブ）{name_of(key)}：「{p.text[:40]}」を受けました。対応します。",
            thread=p.thread or p.id,
        )
        for p in unread
        if p.intent in ("request", "directive", "question")
    ]
    if key == "director":
        return TurnOut(
            report=ReportOut(
                health="green",
                progress=0,
                summary="（スタブ）全体を見ています。",
                blockers=[],
                next=["PdM と今日の対話"],
            ),
            tasks=[],
            posts=posts,
            ask_pdm="（スタブ）今日決めたいこと：最初に検証する顧客と、MVP の範囲。",
            proposals=[],
        )
    if key == "pm":
        late = [k for k in STAGE_BY_ID if rs.get(k) is not None and rs[k].enabled and rs[k].status == "needs_recheck"]
        posts += [
            PostOut(to=k, intent="request", text="（スタブ）上流が変わりました。影響を確かめてください。", thread=0)
            for k in late[:3]
        ]
        return TurnOut(
            report=ReportOut(
                health="yellow" if late else "green",
                progress=0,
                summary="（スタブ）横ぐしで見ています。",
                blockers=[],
                next=[],
            ),
            tasks=[],
            posts=posts,
            ask_pdm="",
            proposals=[],
        )
    fw = fx.FRAMEWORK_BY_STAGE[key]
    d = repo.draft(product.id, key)
    empty = [f for f in fw.fields if f.required and not fx.is_filled(f, d.get(f.key))]
    total = len([f for f in fw.fields if f.required]) or 1
    progress = round(100 * (total - len(empty)) / total)
    return TurnOut(
        report=ReportOut(
            health="green" if not empty else "yellow",
            progress=progress,
            summary=f"（スタブ）必須 {total - len(empty)}/{total} が埋まっています。",
            blockers=[],
            next=[f"「{f.label}」を埋める" for f in empty[:3]],
        ),
        tasks=[
            TaskOut(number=0, title=f"「{f.label}」を埋める", status="todo", owner="agent", detail="")
            for f in empty[:3]
        ],
        posts=posts,
        ask_pdm=(f"（スタブ）「{empty[0].label}」について、方針を教えてください。" if empty else ""),
        proposals=[
            PropOut(field=empty[0].key, value=llm._stub_value(empty[0], product.idea), reason="空欄の仮置き（スタブ）")
        ]
        if empty
        else [],
    )


def _apply(product: Product, key: str, out: TurnOut, job_id: str, model: str, rs: dict) -> list[str]:
    """AI の出力を反映する。返り値はこの投稿で依頼・指示を受けた（すぐ動かす）エージェント。"""
    valid = {*ROLES, *STAGE_BY_ID, "pdm", "all"}
    with session() as s:
        a = _agent(s, product.id, key)
        rep = out.report.model_dump()
        rep["health"] = rep["health"] if rep["health"] in HEALTH else "yellow"
        rep["progress"] = max(0, min(100, int(rep["progress"])))
        rep["at"] = _now().isoformat()
        a.report, a.last_run_at, a.runs = rep, _now(), a.runs + 1
        # 読んだ投稿は既読にする
        for p in s.execute(
            select(BoardPost).where(
                BoardPost.product_id == product.id, BoardPost.recipient == key, BoardPost.read.is_(False)
            )
        ).scalars():
            p.read = True
        s.commit()
    existing = {t["title"] for t in tasks(product, key)}
    for t in out.tasks[:12]:
        if t.number:
            try:
                upsert_task(product, name_of(key), key, t.number, t.title or None, t.status, t.detail or None, t.owner)
            except TeamError:
                continue
        elif t.title.strip() and t.title.strip() not in existing:
            upsert_task(
                product,
                name_of(key),
                key,
                None,
                t.title,
                t.status if t.status in TASK_STATES else "todo",
                t.detail,
                t.owner,
            )
            existing.add(t.title.strip())
    wake: list[str] = []
    for p in out.posts[:8]:
        if p.to not in valid or p.to == key or not p.text.strip():
            continue
        if key in STAGE_BY_ID and p.to == "director":  # 工程の担当は PM を通す
            p.to = "pm"
        thread = p.thread or None
        try:
            post(product, key, p.to, p.intent, p.text, thread, author=model, job_id=job_id)
        except TeamError:
            post(product, key, p.to, p.intent, p.text, None, author=model, job_id=job_id)
        if p.intent in ("request", "directive", "question") and p.to in [*ROLES, *STAGE_BY_ID]:
            wake.append(p.to)
    # 同じ質問を、まだ答えてもらっていないうちに繰り返さない
    with session() as s:
        asked = set(
            s.execute(
                select(BoardPost.text).where(
                    BoardPost.product_id == product.id,
                    BoardPost.sender == key,
                    BoardPost.recipient == "pdm",
                    BoardPost.read.is_(False),
                )
            ).scalars()
        )
    if out.ask_pdm.strip() in asked:
        out.ask_pdm = ""
        if not out.proposals:
            return wake
    if out.ask_pdm.strip():
        title = f"{dt.datetime.now(cron.ZoneInfo('Asia/Tokyo')):%m/%d} の対話" if key == "director" else ""
        thread = _today_thread(product) if key == "director" else None
        post(
            product,
            key,
            "pdm",
            "question",
            out.ask_pdm,
            thread,
            title=title if not thread else "",
            author=model,
            job_id=job_id,
        )
    # 工程の担当の質問と直し案は、その工程の対話にも出す（PdM はいつもの画面で答え、案を採用できる）
    if key in STAGE_BY_ID and (out.ask_pdm.strip() or out.proposals):
        fw = fx.FRAMEWORK_BY_STAGE[key]
        props = []
        for pr in out.proposals[:5]:
            f = fw.get(pr.field)
            if f is None:
                continue
            try:
                props.append(
                    {
                        "id": uuid.uuid4().hex[:10],
                        "field": f.key,
                        "value": fx.coerce(f, pr.value),
                        "reason": pr.reason,
                        "status": "pending",
                    }
                )
            except (ValueError, TypeError):
                continue
        # まだ採用・却下していない同じ項目の案があれば、重ねて出さない
        sess = _agent_session(product, key)
        waiting = {
            p["field"] for m in repo.chat(product.id, key, sess) for p in m["proposals"] if p["status"] == "pending"
        }
        props = [p for p in props if p["field"] not in waiting]
        if not out.ask_pdm.strip() and not props:
            return wake
        text = out.ask_pdm.strip() or f"{len(props)} 項目の直し案があります。"
        repo.add_chat(
            product.id,
            key,
            "assistant",
            f"stage-agent:{key} ({model})",
            text,
            props,
            session_id=sess,
        )
    return wake


def _today_thread(product: Product) -> int | None:
    """今日の司令塔との対話のスレッド（日本時間の今日に司令塔か PdM が立てたもの）。"""
    jst = cron.ZoneInfo("Asia/Tokyo")
    start_day = dt.datetime.now(jst).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(dt.UTC)
    with session() as s:
        p = s.execute(
            select(BoardPost)
            .where(
                BoardPost.product_id == product.id,
                BoardPost.created_at >= start_day,
                or_(
                    (BoardPost.sender == "director") & (BoardPost.recipient == "pdm"),
                    (BoardPost.sender == "pdm") & (BoardPost.recipient == "director"),
                ),
                BoardPost.title.like("%の対話"),
            )
            .order_by(BoardPost.id)
            .limit(1)
        ).scalar_one_or_none()
        return p.thread if p else None


def _agent_session(product: Product, key: str) -> str:
    """工程の担当が PdM に話しかける対話セッション（工程の画面で選べる）。"""
    for x in repo.sessions(product.id, key):
        if x["title"] == "担当エージェントから":
            return x["id"]
    return repo.create_session(product.id, key, name_of(key), "担当エージェントから")


def run(job_id: str) -> None:
    with session() as s:
        j = s.get(JobRun, job_id)
        product = s.get(Product, j.product_id)
        s.expunge(product)
        queue = list(j.params["keys"])
    conn = llmconf.resolve(product.tenant_id)
    done: list[str] = []
    turns = 0
    while queue and turns < MAX_TURNS:
        key = queue.pop(0)
        rs = repo.runs(product.id)
        tid = key if key not in done else f"{key}#{done.count(key) + 1}"
        if tid != key or key not in [t["id"] for t in jobs.run_dict(job_id)["tasks"]]:
            jobs.define_tasks(
                job_id,
                [
                    {
                        "id": tid,
                        "name": f"{name_of(key)}が動く（依頼を受けて）",
                        "group": "依頼",
                        "deps": [done[-1]] if done else [],
                    }
                ],
            )
        with session() as s:
            a = _agent(s, product.id, key)
            mission = a.mission
            unread = list(
                s.execute(
                    select(BoardPost).where(
                        BoardPost.product_id == product.id,
                        BoardPost.recipient.in_([key, "all"]),
                        BoardPost.read.is_(False),
                    )
                ).scalars()
            )
            for p in unread:
                s.expunge(p)
        # 進めていない工程（未着手・完了・閉じている）の担当は、依頼がなければ動かない
        r = rs.get(key)
        if key in STAGE_BY_ID and not unread and (r is None or not r.enabled or r.status in (NOT_STARTED, COMPLETED)):
            jobs.skip_task(job_id, tid, "進めていない工程で、依頼もないので動かない")
            done.append(key)
            continue
        jobs.step(job_id, f"{name_of(key)}が動いています", advance=False)
        with jobs.task(job_id, tid):
            if conn.provider == "stub":
                llm._record("stub", 0, 0)
                out = _stub_turn(product, key, rs, unread)
            else:
                out = llm._json(
                    conn, conn.chat_model, _prompt(product, key, mission, _material(product, key, rs)), TurnOut
                )
            wake = _apply(product, key, out, job_id, conn.chat_model, rs)
            jobs.set_task(
                job_id,
                tid,
                detail=f"{out.report.health}・{out.report.progress}%・投稿 {len(out.posts)}"
                + (f"・{'、'.join(name_of(w) for w in dict.fromkeys(wake))}に依頼" if wake else ""),
            )
        turns += 1
        done.append(key)
        for w in dict.fromkeys(wake):
            if w not in queue and done.count(w) < 2:
                queue.append(w)
    if queue:
        post(
            product,
            "pm",
            "pdm",
            "report",
            f"1回の実行の上限（{MAX_TURNS} 回）に達したので止めました。"
            f"まだ動いていない：{'、'.join(name_of(k) for k in queue)}",
            job_id=job_id,
        )


jobs.HANDLERS["team"] = run


# ---------------- 司令塔と PdM の対話 ----------------
class DirectorOut(BaseModel):
    reply: str
    decided: bool
    strategy: str
    priorities: list[str]
    to_pm: list[str]


def director_talk(product: Product, user: str, text: str, thread: int | None = None) -> dict:
    """PdM が司令塔に話す。司令塔はすぐ答え、戦略が決まったら掲示板に「決定」を残して PM に伝える（PM はすぐ動く）。"""
    text = text.strip()
    if not text:
        raise TeamError(422, "本文が空です")
    ensure(product)
    thread = thread or _today_thread(product)
    title = "" if thread else f"{dt.datetime.now(cron.ZoneInfo('Asia/Tokyo')):%m/%d} の対話"
    mine = post(product, "pdm", "director", "directive", text, thread, title=title, author=user)
    thread = mine["thread"]
    conn = llmconf.resolve(product.tenant_id)
    with session() as s:
        d = _agent(s, product.id, "director")
        memory, mission = dict(d.memory or {}), d.mission
        talk = list(s.execute(select(BoardPost).where(BoardPost.thread == thread).order_by(BoardPost.id)).scalars())
        history = "\n".join(f"{name_of(p.sender)}：{p.text}" for p in talk)
    if conn.provider == "stub":
        llm._record("stub", 0, 0)
        decided = any(w in text for w in ("決定", "でいく", "で行く", "決めた"))
        out = DirectorOut(
            reply=f"（スタブ）承知しました。{'この方針で PM に伝えます。' if decided else '論点を整理します。'}",
            decided=decided,
            strategy=text if decided else "",
            priorities=[text[:60]] if decided else [],
            to_pm=[f"（スタブ）決定：{text[:100]}。各担当に優先順位を伝えてください。"] if decided else [],
        )
    else:
        rs = repo.runs(product.id)
        prompt = (
            f"あなたはプロダクト「{product.name}」の司令塔です。使命：{mission}\n"
            "PdM と対話して戦略を決めます。決めるのは PdM。あなたは状況と選択肢・論点を示し、PdM の意図を確かめる。\n"
            "- reply：日本語で短く直接。前置き・称賛はしない。根拠の弱い意図には率直に指摘する。\n"
            "- PdM がはっきり決めたときだけ decided=true。strategy に決まった戦略を3文以内、priorities に優先順位、"
            "to_pm に PM への指示（各担当に何を優先させるか）を書く。決まっていなければ decided=false、他は空。\n\n"
            f"## これまでの戦略\n{json.dumps(memory, ensure_ascii=False) or '（まだない）'}\n\n"
            f"## 今の状況\n{_material(product, 'director', rs)[:60000]}\n\n## 今日の対話\n{history}\n"
        )
        out = llm._json(conn, conn.chat_model, prompt, DirectorOut)
    reply = post(product, "director", "pdm", "answer", out.reply, thread, author=conn.chat_model)
    with session() as s:
        s.get(BoardPost, mine["id"]).read = True  # 司令塔はその場で読んで答えた
        s.get(BoardPost, reply["id"]).read = True  # 答えは PdM がその場で読んでいる
        s.commit()
    job = None
    if out.decided and out.strategy.strip():
        with session() as s:
            d = _agent(s, product.id, "director")
            d.memory = {
                "strategy": out.strategy.strip(),
                "priorities": out.priorities[:10],
                "decided_at": _now().isoformat(),
                "decided_with": user,
            }
            s.commit()
        post(
            product,
            "director",
            "all",
            "decision",
            f"決定（PdM と合意）：{out.strategy.strip()}"
            + ("\n優先順位：" + "／".join(out.priorities) if out.priorities else ""),
            thread,
            author=conn.chat_model,
        )
        for t in out.to_pm[:5]:
            post(product, "director", "pm", "directive", t, thread, author=conn.chat_model)
        if out.to_pm:
            job = start(product, user, ["pm"], reason="司令塔からの指示")
    return {"thread": thread, "reply": reply, "decided": out.decided, "job_id": job}


def director_view(product: Product) -> dict:
    ensure(product)
    with session() as s:
        d = _agent(s, product.id, "director")
        memory = d.memory or {}
    thread = _today_thread(product)
    posts = board(product, thread=thread)["threads"][0]["posts"] if thread else []
    return {"strategy": memory, "thread": thread, "posts": posts}


def stage_context(product_id: str, stage_id: str) -> str:
    """工程の画面の対話で、担当エージェントが前提にするもの（使命・戦略・未完了タスク・掲示板の最近の投稿）。"""
    with session() as s:
        a = s.execute(
            select(TeamAgent).where(TeamAgent.product_id == product_id, TeamAgent.key == stage_id)
        ).scalar_one_or_none()
        d = s.execute(
            select(TeamAgent).where(TeamAgent.product_id == product_id, TeamAgent.key == "director")
        ).scalar_one_or_none()
        if a is None:
            return ""
        open_tasks = list(
            s.execute(
                select(AgentTask).where(
                    AgentTask.product_id == product_id, AgentTask.agent == stage_id, AgentTask.status != "done"
                )
            ).scalars()
        )
        posts = _context_posts(s, product_id, stage_id, 12)
        lines = [f"あなたは{name_of(stage_id)}。使命：{a.mission}"]
        if d is not None and (d.memory or {}).get("strategy"):
            lines.append(f"戦略（PdM と司令塔の決定）：{d.memory['strategy']}")
        lines += [f"- タスク TS-{t.number}［{t.status}］{t.title}" for t in open_tasks]
        lines += [f"- 掲示板 {name_of(p.sender)}→{name_of(p.recipient)}（{p.intent}）：{p.text[:300]}" for p in posts]
        return "\n".join(lines)


def dashboard(product: Product) -> dict:
    """ダッシュボード：エージェントの報告・各案（PP-n）がどの工程まであるか・最近のやり取り（誰から誰へ）・PdM 宛て。"""
    from .db import AgentFinding, Variant

    ensure(product)
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
                select(BoardPost)
                .where(BoardPost.product_id == product.id, BoardPost.created_at >= since)
                .order_by(BoardPost.id)
            ).scalars()
        )
        to_pdm = list(
            s.execute(
                select(BoardPost)
                .where(BoardPost.product_id == product.id, BoardPost.recipient == "pdm")
                .order_by(BoardPost.id.desc())
                .limit(20)
            ).scalars()
        )
        findings = s.execute(
            select(func.count()).where(AgentFinding.product_id == product.id, AgentFinding.status == "open")
        ).scalar()
        running = s.execute(
            select(JobRun.id).where(
                JobRun.product_id == product.id, JobRun.kind == "team", JobRun.status.in_(("queued", "running"))
            )
        ).first()
    edges: dict[tuple[str, str], dict] = {}
    for p in recent:
        if p.sender == "pdm" or p.recipient in ("pdm", "all"):
            continue
        e = edges.setdefault((p.sender, p.recipient), {"source": p.sender, "target": p.recipient, "count": 0})
        e["count"] += 1
        e["last"] = {"intent": p.intent, "text": p.text[:140], "at": _iso(p.created_at), "thread": p.thread}
    return {
        **overview(product),
        "variants": variants,
        "edges": list(edges.values()),
        "to_pdm": [post_dict(p) for p in to_pdm],
        "findings_open": findings,
        "running": running is not None,
        "director": director_view(product),
    }


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
                AgentTask.product_id == product.id, AgentTask.agent == key, AgentTask.status != "done"
            )
        ).scalar()
        return agent_dict(a, n)


def mark_read_from(product_id: str, key: str) -> None:
    with session() as s:
        q = select(BoardPost).where(
            BoardPost.product_id == product_id,
            BoardPost.sender == key,
            BoardPost.recipient == "pdm",
            BoardPost.read.is_(False),
        )
        for x in s.execute(q).scalars():
            x.read = True
        s.commit()
