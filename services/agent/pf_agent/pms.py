"""PM（事業 PM・設計 PM・実装 PM）の仕事：PdM との対話、1時間ごとの状況確認、PM のタスク管理の場所（PmNote）。

状況確認（check）
1. 領域の担当ごとに、報告・自分宛ての Issue・工程の状態を集める（AI を使わない）。担当は全員が掲示板で返事をし
   （「定時の状況確認」スレッド。変わっていない担当も今の状況を返す）、変わった担当の状況を
   PM のタスク管理の場所に記録する
2. PM 宛ての Issue（担当からの質問・PdM の指示・解決した Issue の確かめ）と、変わったことがあるときだけ AI を呼ぶ：
   リスクを記録し、Issue を返す・起票する。PdM に急いで伝えることは PM との対話に書く
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json

from pydantic import BaseModel, Field
from sqlalchemy import func, select

from . import cron, fwlib, llm, llmconf, repo
from .asks import PdmAsk
from .db import AgentIssue, IssueJournal, PmMessage, PmNote, Product, TeamAgent, session
from .stages import STAGE_BY_ID
from .team import (
    ACTIONABLE,
    DOMAIN,
    KEYS,
    OPEN,
    PMS,
    IssueUpdateOut,
    NewIssueOut,
    PostOut,
    TeamError,
    _agent,
    _iso,
    _now,
    inbox,
    inbox_md,
    mark_read,
    name_of,
    post,
    wakes_from,
)

KINDS = {"status": "状況", "risk": "リスク", "decision": "決めたこと", "memo": "メモ"}
JST = cron.ZoneInfo("Asia/Tokyo")


def message_dict(m: PmMessage) -> dict:
    return {
        "id": m.id,
        "pm": m.pm,
        "pm_name": name_of(m.pm),
        "role": m.role,
        "author": m.author,
        "text": m.text,
        "stage_id": m.stage_id,
        "meeting_id": m.meeting_id,
        "attachments": m.attachments or [],
        "issues": m.issues or [],
        "created_at": _iso(m.created_at),
    }


def note_dict(n: PmNote) -> dict:
    return {
        "id": n.id,
        "pm": n.pm,
        "agent": n.agent,
        "agent_name": name_of(n.agent) if n.agent else "",
        "kind": n.kind,
        "kind_label": KINDS.get(n.kind, n.kind),
        "text": n.text,
        "meeting_id": n.meeting_id,
        "created_at": _iso(n.created_at),
    }


def _check_pm(pm: str) -> None:
    if pm not in PMS:
        raise TeamError(404, "PdM が話せるのは PM（事業 PM・設計 PM・実装 PM）だけです")


def add_note(product_id: str, pm: str, agent: str, kind: str, text: str) -> None:
    with session() as s:
        s.add(
            PmNote(
                product_id=product_id,
                pm=pm,
                agent=agent if agent in KEYS else "",
                kind=kind if kind in KINDS else "memo",
                text=text[:4000],
            )
        )
        s.commit()


# ---------------- 状況確認（1時間ごと） ----------------
def snapshot(product_id: str, key: str, rs: dict) -> str:
    with session() as s:
        a = s.execute(select(TeamAgent).where(TeamAgent.product_id == product_id, TeamAgent.key == key)).scalar_one()
        issues = list(
            s.execute(
                select(AgentIssue).where(
                    AgentIssue.product_id == product_id, AgentIssue.assignee == key, AgentIssue.status.in_(OPEN)
                )
            ).scalars()
        )
        rep = a.report or {}
    r = rs.get(key)
    ja = {
        "not_started": "未着手",
        "in_progress": "作業中",
        "awaiting_approval": "承認待ち",
        "revising": "修正中",
        "completed": "完了",
        "skipped": "スキップ",
        "needs_recheck": "要再確認",
    }
    st = "閉じている" if r is not None and not r.enabled else (ja.get(r.status, r.status) if r else "-")
    return (
        f"工程の状態：{st}・進み具合 {rep.get('progress', '-')}%・{rep.get('health', '未報告')}。"
        f"{rep.get('summary', '')}"
        + (f" 止まっていること：{'／'.join(rep.get('blockers') or [])}。" if rep.get("blockers") else "")
        + f" 自分宛ての Issue {len(issues)} 件"
        + (f"（{'、'.join(f'#{i.number}{i.subject[:20]}［{i.status}］' for i in issues[:5])}）" if issues else "")
        + "。"
    )


class NoteOut(BaseModel):
    agent: str  # 担当の key（PM 全体のことなら空）
    kind: str  # risk | decision | memo
    text: str


class PmCheckOut(BaseModel):
    notes: list[NoteOut]
    issue_updates: list[IssueUpdateOut]
    new_issues: list[NewIssueOut]
    posts: list[PostOut]
    to_pdm: list[PdmAsk]  # PdM への質問・相談・合意依頼・終了承認依頼（なければ空。報告だけのものは書かない）


def check(product: Product, pm: str, job_id: str, conn, full: bool = True) -> tuple[list[str], str]:
    """状況確認。full は定時（予定・今すぐ動かす）：領域の担当に状況確認を出して集める。
    full でないときは、Issue や掲示板で起こされたとき：PM 宛ての Issue と掲示板の未読に答えるだけ。
    返り値は（すぐ動かすエージェント, 工程に出す一言）。"""

    rs = repo.runs(product.id)
    with session() as s:
        me = _agent(s, product.id, pm)
        memory = dict(me.memory or {})
    seen = dict(memory.get("seen") or {})
    changed: dict[str, str] = {}
    box = inbox(product.id, pm)
    for key in DOMAIN[pm] if full else ():
        snap = snapshot(product.id, key, rs)
        h = hashlib.sha256(snap.encode()).hexdigest()[:16]
        if seen.get(key) != h:
            changed[key] = snap
            seen[key] = h
    now_jst = dt.datetime.now(JST)
    unchanged = [k for k in DOMAIN[pm] if k not in changed]
    if full:
        _status_round(product, pm, job_id, rs, changed, unchanged, now_jst)
    # PM 宛ての Issue（まだ自分が手を付けていないか、誰かが書き足したもの）
    todo = _todo(product, pm)
    memory["seen"] = seen
    memory["checked_at"] = _now().isoformat()
    with session() as s:
        me = _agent(s, product.id, pm)
        me.memory, me.last_run_at, me.runs = memory, _now(), me.runs + 1
        s.commit()
    if not changed and not todo and not box:
        return [], "変化なし（AI は使っていない）"
    return _think(product, pm, job_id, conn, rs, changed, todo, box)


def _status_round(product: Product, pm: str, job_id: str, rs: dict, changed: dict, unchanged: list, now_jst) -> None:
    root = post(
        product,
        pm,
        "all",
        "confirm",
        f"{name_of(pm)}の定時の状況確認です。領域（{'・'.join(STAGE_BY_ID[k].no for k in DOMAIN[pm])}）"
        "の担当は、進み具合・止まっていること・Issue の状況を返してください。",
        title=f"{name_of(pm)} 定時の状況確認 {now_jst:%m/%d %H:%M}",
        job_id=job_id,
    )
    # 領域の担当は全員が返事をする（変わっていない担当も、今の状況を自分で返す）。PM はこの場で読むので既読にする
    for key in DOMAIN[pm]:
        snap = changed.get(key) or snapshot(product.id, key, rs)
        text = snap if key in changed else f"前回から変化なし。{snap}"
        post(product, key, pm, "answer", text, root["thread"], job_id=job_id, read=True)
        if key in changed:
            add_note(product.id, pm, key, "status", snap)
    post(
        product,
        pm,
        "all",
        "notice",
        f"全員（{len(DOMAIN[pm])}人）から返事をもらいました。"
        + (f"変化あり：{'、'.join(name_of(k) for k in changed)}" if changed else "前回から変化はありません")
        + (f"／変化なし：{'、'.join(name_of(k) for k in unchanged)}" if changed and unchanged else ""),
        root["thread"],
        job_id=job_id,
    )


def _todo(product: Product, pm: str) -> list[tuple]:
    with session() as s:
        mine = list(
            s.execute(
                select(AgentIssue).where(
                    AgentIssue.product_id == product.id,
                    AgentIssue.assignee == pm,
                    AgentIssue.status.in_((*ACTIONABLE, "resolved")),
                )
            ).scalars()
        )
        todo = []
        for i in mine:
            last = s.execute(
                select(IssueJournal).where(IssueJournal.issue_id == i.id).order_by(IssueJournal.id.desc()).limit(1)
            ).scalar_one_or_none()
            if last is None or last.author != pm:
                todo.append(
                    (
                        i.number,
                        i.subject,
                        i.status,
                        i.description[:1200],
                        i.author,
                        [
                            j.notes[:400]
                            for j in s.execute(
                                select(IssueJournal).where(IssueJournal.issue_id == i.id).order_by(IssueJournal.id)
                            ).scalars()
                        ][-4:],
                    )
                )
    return todo


def _think(product: Product, pm: str, job_id: str, conn, rs: dict, changed: dict, todo: list, box: list):
    from . import agentrun, asks, cycles, facts
    from . import issues as iss

    prep = agentrun.prepare(product.tenant_id, product, pm)
    if conn.provider == "stub":
        llm._record("stub", 0, 0)
        out = PmCheckOut(
            notes=[],
            posts=[
                PostOut(to=p.sender, intent="answer", text=f"（スタブ）確認しました：{p.text[:40]}", thread=p.thread)
                for p in box
                if p.intent == "confirm" and p.sender in KEYS
            ],
            new_issues=[],
            to_pdm=[],
            issue_updates=[
                IssueUpdateOut(
                    number=n,
                    notes="（スタブ）確かめました。終了します。"
                    if st == "resolved"
                    else "（スタブ）受けました。担当に振り分けて進めます。",
                    status="closed" if st == "resolved" else "in_progress",
                    done_ratio=100 if st == "resolved" else 10,
                    assign_to="",
                )
                for n, _, st, *_ in todo
            ],
        )
    else:
        others = {k: snapshot(product.id, k, rs) for k in DOMAIN[pm] if k not in changed}
        prompt = (
            f"あなたはプロダクト「{product.name}」の{name_of(pm)}です。"
            f"領域：{'、'.join(f'{k}={name_of(k)}' for k in DOMAIN[pm])}。\n"
            + prep.header()
            + (
                "\n\n定時の状況確認です。担当の状況を読み、PM のタスク管理の場所に残すこと（notes）と、"
                "手を打つことを決めます。\n"
                if changed
                else "\n\nIssue・掲示板で呼ばれました。PM 宛ての Issue と、"
                "掲示板で自分宛てに来た確認・回答に、いま答えます。\n"
            )
            + "- notes：遅れ・止まっていること・工程間の食い違い・決めるべきことを、"
            "担当ごとに短く（kind は risk・decision・memo）。"
            "状況そのものは記録済みなので繰り返さない。\n"
            "- issue_updates：PM 宛ての Issue に答える。質問には答え、担当が解決したものは確かめて closed、"
            "担当に振るものは assign_to にその担当。PdM に答えてもらうことは to_pdm に書き、"
            "Issue は feedback にする。\n"
            "- new_issues：止まっている担当・食い違いの解消に、"
            "担当に動いてもらうことだけ起票する（宛先は pm_*・s01〜s14）。\n"
            "- posts：他の PM・担当に確認が要ることだけ掲示板に（confirm・answer・notice）。"
            "未読の確認（confirm）には、そのスレッドに answer で答える。回答への返事は書かない。"
            "確認と回答は相手がすぐ動いて読むので、期限や時刻（「本日15時までに」など）は書かない。\n"
            f"- to_pdm：{asks.RULE} なければ空（ふだんのことは会議で報告する）。\n\n"
            + f"## PdM がまだ答えていない、自分からの問いかけ（同じことは聞かない）"
                f"\n{asks.open_asks_md(product.id, pm)}\n\n"
            + (f"## 掲示板の未読（自分宛て）\n{inbox_md(box)}\n\n" if box else "")
            + cycles.pm_md(product.id, pm)
            + f"## 事実と権限\n{facts.RULE}\n\n" + facts.system_facts(product.id).md + "\n"
            + f"## 変わった担当の状況\n{json.dumps(changed, ensure_ascii=False)}\n\n"
            f"## 変わっていない担当\n{json.dumps(others, ensure_ascii=False)}\n\n"
            "## PM 宛ての Issue\n"
            + "\n".join(
                f"- #{n}［{st}］{subj}（起票：{name_of(a) if a in KEYS else 'PdM'}）\n  {d}\n  記録：{j}"
                for n, subj, st, d, a, j in todo
            )
            + "\n"
        )
        out = agentrun.think(conn, prep, prompt, PmCheckOut)
    # 割り当てていない書くツールの欄は捨てる
    out.notes = out.notes if prep.can("pm_note") else []
    out.issue_updates = out.issue_updates if prep.can("issue_update") else []
    out.new_issues = out.new_issues if prep.can("issue_create") else []
    out.posts = out.posts if prep.can("board_post") else []
    wake: list[str] = []
    for n in out.notes[:10]:
        if n.text.strip():  # 根拠のない状態の主張には印を付けて残す（PM 同士の連絡の材料になるので）
            add_note(product.id, pm, n.agent, n.kind, facts.scrub(product.id, n.text, mark=True)[0])
    for u in out.issue_updates[:10]:
        try:
            iss.update(
                product,
                pm,
                u.number,
                notes=facts.scrub(product.id, u.notes, u.evidence, mark=True)[0],
                status=u.status,
                done_ratio=u.done_ratio,
                assignee=u.assign_to or None,
                wake=False,
            )
            if u.assign_to in KEYS and u.assign_to != pm:
                wake.append(u.assign_to)
        except iss.IssueError:
            continue
    for n in out.new_issues[:5]:
        try:
            wake.append(
                iss.create(
                    product,
                    pm,
                    n.assignee,
                    n.subject,
                    n.description,
                    tracker=n.tracker,
                    priority=n.priority,
                    wake=False,
                )["assignee"]
            )
        except iss.IssueError:
            continue
    mark_read(product.id, pm)  # 未読は、この場で読んだ
    posted = []
    for p in out.posts[:5]:
        if not (p.to in (*KEYS, "all") and p.to != pm and p.text.strip()):
            continue
        if not facts.check(product.id, p.text, p.evidence)[1]:  # 根拠のない状態の主張を含む投稿は載せない
            posted.append(post(product, pm, p.to, p.intent, p.text, p.thread or None, job_id=job_id))
    wake += wakes_from(product.id, pm, posted)
    asked = sum(1 for a in out.to_pdm[:3] if asks.send(product, pm, a))
    return wake, (
        f"変化 {len(changed)}人・Issue {len(todo)}件・掲示板 {len(box)}件"
        + (f"・{len(set(wake))}人に依頼" if wake else "")
        + (f"・PdM に {asked} 件" if asked else "")
    )


# ---------------- PM 同士の連絡（10分ごと） ----------------
class SyncPostOut(BaseModel):
    sender: str  # pm_biz | pm_design | pm_impl
    to: str  # 相手の PM
    intent: str  # confirm | answer | notice
    text: str
    evidence: list[str] = Field(default_factory=list)  # 根拠の ID（job:… / issue:#n / note:n / report:key）


class PmSyncOut(BaseModel):
    posts: list[SyncPostOut]


def _domain_of(key: str) -> str | None:
    if key in PMS:
        return key
    return next((pm for pm, ks in DOMAIN.items() if key in ks), None)


def sync_material(product: Product, since_note: int) -> tuple[dict[str, str], int]:
    """PM ごとの、他の領域に関わる材料：前回からの記録・領域をまたぐ開いた Issue・自分の領域の担当の報告。"""
    with session() as s:
        notes = list(
            s.execute(
                select(PmNote).where(PmNote.product_id == product.id, PmNote.id > since_note).order_by(PmNote.id)
            ).scalars()
        )
        cross = [
            i
            for i in s.execute(
                select(AgentIssue).where(AgentIssue.product_id == product.id, AgentIssue.status.in_(OPEN))
            ).scalars()
            if _domain_of(i.author) and _domain_of(i.assignee) and _domain_of(i.author) != _domain_of(i.assignee)
        ]
        agents = {
            a.key: a for a in s.execute(select(TeamAgent).where(TeamAgent.product_id == product.id)).scalars()
        }
    out = {}
    for pm in PMS:
        mine = [n for n in notes if n.pm == pm][-12:]
        reps = [
            f"- [report:{k}] {name_of(k)}：{(agents[k].report or {}).get('summary', '')[:200]}"
            for k in DOMAIN[pm]
            if k in agents and (agents[k].report or {}).get("summary")
        ]
        iss = [
            f"- [issue:#{i.number}]［{i.status}］{i.subject}（{name_of(i.author)}→{name_of(i.assignee)}）"
            for i in cross
            if pm in (_domain_of(i.author), _domain_of(i.assignee))
        ]
        out[pm] = (
            ("### 前回からの記録\n" + "\n".join(f"- [note:{n.id}]（{n.kind}）{n.text[:300]}" for n in mine) + "\n"
             if mine else "")
            + ("### 領域をまたぐ開いた Issue\n" + "\n".join(iss) + "\n" if iss else "")
            + ("### 担当の報告\n" + "\n".join(reps) + "\n" if reps else "")
        )
    return out, max((n.id for n in notes), default=since_note)


def sync(product: Product, job_id: str, conn) -> tuple[list[str], str]:
    """事業・設計・実装 PM が、他の領域に関わること（依存・食い違い・確認）を掲示板で伝え合う。
    前回から材料が変わっていなければ AI は使わない。確認（confirm）を受けた PM はすぐ動いて答える。"""
    from .team import PM_SYNC

    with session() as s:
        me = _agent(s, product.id, PM_SYNC)
        memory = dict(me.memory or {})
    from . import facts, refs

    material, last_note = sync_material(product, int(memory.get("note") or 0))
    fx_ = facts.system_facts(product.id)
    h = hashlib.sha256(
        json.dumps({**material, "_facts": fx_.md}, ensure_ascii=False, sort_keys=True).encode()
    ).hexdigest()[:16]
    changed = h != memory.get("hash") and any(material.values())
    with session() as s:
        me = _agent(s, product.id, PM_SYNC)
        me.memory = {**memory, "hash": h, "note": last_note, "checked_at": _now().isoformat()}
        me.last_run_at, me.runs = _now(), me.runs + 1
        s.commit()
    if not changed:
        return [], "前回から変化なし（AI は使っていない）"
    stamp = dt.datetime.now(JST)
    out = _sync_out(product, conn, material, fx_.md, stamp)
    # 状態が変わったという主張は、根拠の ID を照合してから載せる（LLM は使わない）。照合できない投稿は捨てて記録する
    allowed = fx_.ids | refs.cited("".join(material.values()))  # 材料と事実の欄に出した ID だけを根拠として認める
    posted: list[dict] = []
    dropped: list[str] = []
    thread = None
    for p in out.posts[:6]:
        if p.sender not in PMS or p.to not in PMS or p.sender == p.to or not p.text.strip():
            continue
        _, bad = facts.check(product.id, p.text, p.evidence, allowed)
        if bad:
            dropped.append(f"{name_of(p.sender)}→{name_of(p.to)}：{p.text[:200]}")
            add_note(product.id, p.sender, "", "memo",
                     "根拠のない状態の主張を含むので、PM 同士の連絡に載せませんでした："
                     + " ".join(x.strip() for x in bad)[:400] + f"（根拠：{', '.join(p.evidence) or 'なし'}）")
            continue
        intent = p.intent if p.intent in ("confirm", "answer", "notice") else "notice"
        made = post(product, p.sender, p.to, intent, p.text, thread, title=f"PM 同士の連絡 {stamp:%m/%d %H:%M}",
                    job_id=job_id)
        thread = thread or made["thread"]
        posted.append(made)
    wake = []
    for p in posted:
        wake += wakes_from(product.id, p["sender"], [p])
    who = "、".join(name_of(w) for w in dict.fromkeys(wake))
    return wake, (f"連絡 {len(posted)} 件" + (f"・{who}が答える" if wake else "")
                  + (f"・根拠のない主張で {len(dropped)} 件を載せなかった" if dropped else ""))


def _sync_out(product: Product, conn, material: dict[str, str], facts_md: str, stamp) -> PmSyncOut:
    """PM 同士の連絡の下書き（LLM）。"""
    from . import facts

    if conn.provider == "stub":
        llm._record("stub", 0, 0)
        order = list(PMS)
        out = PmSyncOut(
            posts=[
                SyncPostOut(
                    sender=pm,
                    to=order[(order.index(pm) + 1) % len(order)],
                    intent="confirm",
                    text=f"（スタブ）{name_of(pm)}の領域で変化がありました。そちらの領域への影響を確認してください。",
                )
                for pm in PMS
                if material[pm]
            ][:3]
        )
    else:
        prompt = (
            f"プロダクト「{product.name}」（{product.idea}）の事業PM（①〜⑤）・設計PM（⑥〜⑪）・実装PM（⑫〜⑬）の、"
            "10分ごとの連絡です。各 PM の材料を読み、他の PM に伝える必要があることだけを posts に書きます。\n"
            "- 伝えるのは、領域をまたぐ依存・前提の食い違い・相手の判断が要ること・相手の作業に影響する変化だけ。"
            "自分の領域の中だけで済むことや、ただの状況報告は書かない。何もなければ posts は空。\n"
            "- sender と to は pm_biz・pm_design・pm_impl（自分宛ては不可）。intent は confirm（相手に答えてほしい）・"
            "notice（読んでもらうだけ）。confirm を受けた PM はすぐ動いて答える。\n"
            f"- いまは {stamp:%Y/%m/%d %H:%M}（日本時間）。期限や時刻（「本日15時までに」など）は書かない。"
            f"1件は3文まで。\n"
            f"- {facts.RULE}\n"
            "- evidence には、その投稿の根拠になった材料の ID（行の頭の [ ] の中）を入れる。"
            "状態の変化を書かない連絡なら空でよい。\n\n"
            + facts_md + "\n"
            + "\n".join(f"## {name_of(pm)}\n{material[pm] or '（変化なし）'}" for pm in PMS)
        )
        out = llm._json(conn, conn.chat_model, prompt, PmSyncOut)
    return out


# ---------------- PdM との対話 ----------------
def _say(
    product_id: str,
    pm: str,
    role: str,
    author: str,
    text: str,
    stage_id: str | None = None,
    meeting_id: int | None = None,
    attachments: list | None = None,
    issues: list | None = None,
) -> dict:
    with session() as s:
        m = PmMessage(
            product_id=product_id,
            pm=pm,
            role=role,
            author=author[:200],
            text=text[:8000],
            stage_id=stage_id if stage_id in STAGE_BY_ID else None,
            meeting_id=meeting_id,
            attachments=attachments or None,
            issues=issues or None,
        )
        s.add(m)
        s.commit()
        return message_dict(m)


class PmReply(BaseModel):
    reply: str
    issues: list[NewIssueOut]
    notes: list[str]


def messages(
    product: Product,
    pm: str | None = None,
    stage_id: str | None = None,
    meeting_id: int | None = None,
    limit: int = 100,
) -> list[dict]:
    with session() as s:
        q = select(PmMessage).where(PmMessage.product_id == product.id)
        if pm:
            q = q.where(PmMessage.pm == pm)
        if stage_id:
            q = q.where(PmMessage.stage_id == stage_id)
        if meeting_id is not None:
            q = q.where(PmMessage.meeting_id == meeting_id)
        rows = list(s.execute(q.order_by(PmMessage.id.desc()).limit(limit)).scalars())
    return [message_dict(m) for m in reversed(rows)]


def talk(
    product: Product,
    user: str,
    pm: str,
    text: str,
    stage_id: str | None = None,
    meeting_id: int | None = None,
    attachment_ids: list[int] | None = None,
) -> dict:
    """PdM が PM に話す。PM はすぐ答え、必要なら担当への Issue を起票する（担当はすぐ動く）。"""
    from . import attachments, facts
    from . import issues as iss
    from .team import ensure

    _check_pm(pm)
    text = text.strip()
    if not text:
        raise TeamError(422, "本文が空です")
    ensure(product)
    try:
        files = attachments.take(product, pm, attachment_ids or [])
    except attachments.AttachmentError as e:
        raise TeamError(e.status, e.message) from None
    extra, images = attachments.material([f["id"] for f in files])
    mine = _say(product.id, pm, "pdm", user, text, stage_id, meeting_id, files)
    conn = llmconf.resolve(product.tenant_id)
    from . import agentrun

    prep = agentrun.prepare(product.tenant_id, product, pm)
    history = messages(product, pm, limit=16)
    rs = repo.runs(product.id)
    if conn.provider == "stub":
        llm._record("stub", 0, 0)
        target = (
            stage_id
            if stage_id in DOMAIN[pm]
            else next((k for k in DOMAIN[pm] if STAGE_BY_ID[k].name in text or STAGE_BY_ID[k].no in text), None)
        )
        out = PmReply(
            reply="（スタブ）承知しました。"
            + (f"{name_of(target)}に Issue を起票します。" if target else "状況を確かめます。"),
            issues=[
                NewIssueOut(
                    assignee=target,
                    tracker="task",
                    subject=text[:80],
                    description=f"PdM の指示：{text}",
                    priority="normal",
                )
            ]
            if target
            else [],
            notes=[],
        )
    else:
        status = "\n".join(f"- {k} {name_of(k)}：{snapshot(product.id, k, rs)}" for k in DOMAIN[pm])
        with session() as s:
            open_issues = list(
                s.execute(
                    select(AgentIssue).where(AgentIssue.product_id == product.id, AgentIssue.status.in_(OPEN))
                ).scalars()
            )
        stage_md = ""
        if stage_id in STAGE_BY_ID:
            from . import frameworks as fx

            stage_md = fx.to_markdown(
                STAGE_BY_ID[stage_id], fwlib.of(product.id, stage_id), repo.draft(product.id, stage_id)
            )[:20000]
        prompt = (
            f"あなたはプロダクト「{product.name}」（{product.idea}）の{name_of(pm)}です。PdM（人）と話しています。"
            "PdM が話せるのは PM だけで、担当には PM が Issue で伝えます。\n"
            + prep.header()
            + "\n\n## 出力\n"
            "- reply：日本語で短く直接答える。前置きや称賛は書かない。根拠の弱い意図には率直に指摘する。"
            "報告だけで終えず、最後は自分が次にやることか、PdM への質問・相談・合意依頼・終了承認依頼で終える。"
            f"期限や時刻は書かない。{facts.RULE}\n"
            "- issues：PdM の意思を担当に伝える必要があるときだけ起票する。宛先は自分の領域の担当（"
            + "、".join(DOMAIN[pm])
            + "）か他の PM（pm_biz・pm_design・pm_impl）。subject は何をしてほしいか、"
            "description に PdM の意図・決まったこと・完了の条件を書く。\n"
            "- notes：決まったこと・覚えておくことを PM のタスク管理の場所に残す（なければ空）。\n\n"
            f"## 領域の担当の状況\n{status}\n\n"
            "## 終わっていない Issue\n"
            + "\n".join(
                f"- #{i.number}［{i.status}］{i.subject} "
                f"{name_of(i.author) if i.author in KEYS else 'PdM'}→{name_of(i.assignee)}"
                for i in open_issues[:40]
            )
            + "\n\n"
            + (f"## PdM がいま見ている工程（{stage_id}）\n{stage_md}\n\n" if stage_md else "")
            + "## これまでの対話\n"
            + "\n".join(f"{'PdM' if m['role'] == 'pdm' else name_of(pm)}：{m['text'][:800]}" for m in history)
            + "\n"
            + (f"\n{extra}\n" if extra else "")
        )
        out = agentrun.think(conn, prep, prompt, PmReply, images)
    out.issues = out.issues if prep.can("issue_create") else []
    out.notes = out.notes if prep.can("pm_note") else []
    made = []
    for n in out.issues[:5]:
        try:
            i = iss.create(
                product,
                pm,
                n.assignee,
                n.subject,
                n.description,
                tracker=n.tracker,
                priority=n.priority,
                stage_id=stage_id or (n.assignee if n.assignee in STAGE_BY_ID else None),
            )
            made.append(i["number"])
        except iss.IssueError:
            continue
    for t in out.notes[:5]:
        if t.strip():
            add_note(product.id, pm, "", "decision", t)
    reply = out.reply + (f"\n（起票：{'、'.join(f'#{n}' for n in made)}）" if made else "")
    answer = _say(product.id, pm, "pm", f"{name_of(pm)} ({conn.chat_model})", reply, stage_id, meeting_id, issues=made)
    return {"message": mine, "reply": answer, "issues": made}


def workspace(product: Product, pm: str) -> dict:
    """PM のタスク管理の場所：拾い集めたこと（会議でまだ伝えていないもの）・PM が持つ Issue・PdM との対話。"""
    from . import issues as iss
    from .team import ensure, member

    _check_pm(pm)
    ensure(product)
    with session() as s:
        notes = list(
            s.execute(
                select(PmNote)
                .where(PmNote.product_id == product.id, PmNote.pm == pm)
                .order_by(PmNote.id.desc())
                .limit(200)
            ).scalars()
        )
        pending = s.execute(
            select(func.count()).where(PmNote.product_id == product.id, PmNote.pm == pm, PmNote.meeting_id.is_(None))
        ).scalar()
        me = _agent(s, product.id, pm)
        checked = (me.memory or {}).get("checked_at")
    return {
        "pm": member(product, pm),
        "domain": [{"key": k, "name": name_of(k)} for k in DOMAIN[pm]],
        "notes": [note_dict(n) for n in notes],
        "pending": pending,
        "checked_at": checked,
        "assigned": iss.search(product, assignee=pm, open_only=True),
        "authored": iss.search(product, author=pm, open_only=True),
        "messages": messages(product, pm, limit=60),
    }
