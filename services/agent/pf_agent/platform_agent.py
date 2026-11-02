"""プラットフォームエージェント：ファクトリー全体（テナント単位）がきちんと動いているかを見張り、PdM と直接話す。

PM・工程の担当とは別の存在で、プロダクトの中身ではなく「処理系」を見る。
- 検知（detect）：AI を使わず、記録から決まった規則で見つける。定期実行（tick）から5分ごと、画面を開いたときにも動く
  - 定期実行（tick）が止まっている・ジョブが始まらない
  - ジョブの失敗（種類・プロダクト・原因ごとにまとめる。LLM の利用上限・認証の失敗は重く扱う）
  - 担当が拾っていない Issue・やり取りが往復し続ける Issue・期日を過ぎた／止まった Issue
  - 予定の時刻を過ぎても動いていないエージェント・止めているのに Issue を抱えたエージェント・詰まっている担当
  同じ問題は fingerprint で1件にまとめ、見つからなくなったら自動で解決にする。重い問題が新しく出たら PdM に知らせる
- 対話（talk）：PdM の問いに、いまの稼働状況と問題を材料に答え、運用上の対処と処理系（コード）の修正案を出す
- 対処（act）：再実行・予定の立て直し・止めたエージェントの再開など、安全なものだけを PdM の承認で実行する。
  コードの修正は提案だけで、自分では直さない
"""

from __future__ import annotations

import datetime as dt
import hashlib
import re

from pydantic import BaseModel, Field
from sqlalchemy import func, select

from . import cron, jobs, llm, llmconf
from .db import (
    AgentIssue,
    AssistantMessage,
    IssueJournal,
    JobRun,
    PlatformFinding,
    PlatformMessage,
    Product,
    SystemBeat,
    TeamAgent,
    session,
)

NAME = "プラットフォーム"
SEVERITY = {"high": "重い", "medium": "中", "low": "軽い"}
TICK_STALE_MIN = 5
QUEUE_STALE_MIN = 10
WAIT_MIN = {"stage": 30, "pm": 120}  # 担当が Issue を拾うまでの目安（10分ごと・1時間ごとの定期実行の数回分）
PINGPONG = 12
STALE_DAYS = 3
MISSED_MIN = 15
JST = cron.ZoneInfo("Asia/Tokyo")


class PlatformError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def _aware(t: dt.datetime | None) -> dt.datetime | None:
    return None if t is None else t if t.tzinfo else t.replace(tzinfo=dt.UTC)


def _iso(t: dt.datetime | None) -> str | None:
    t = _aware(t)
    return t.isoformat() if t else None


def _ago(t: dt.datetime, now: dt.datetime) -> str:
    m = int((now - _aware(t)).total_seconds() // 60)
    return f"{m} 分前" if m < 120 else f"{m // 60} 時間前" if m < 48 * 60 else f"{m // 1440} 日前"


# ---------------- 検知 ----------------
def _category(error: str) -> str:
    e = error or ""
    if re.search(r"429|RESOURCE_EXHAUSTED|rate.?limit|quota|overloaded", e, re.I):
        return "rate"
    if re.search(r"\b401\b|\b403\b|api.?key|PERMISSION_DENIED|unauthori[sz]ed|authentication", e, re.I):
        return "auth"
    if re.search(r"時間切れ|timeout|timed out|DEADLINE", e, re.I):
        return "timeout"
    return "error"


CATEGORY = {
    "rate": (
        "LLM の利用上限に当たっています",
        "high",
        "LLM 設定でモデルを軽いものに切り替えるか、定期実行の間隔（エージェントの組織）を広げてください。"
        "続くなら、プロバイダーの利用上限の引き上げを申請してください。",
    ),
    "auth": (
        "LLM・外部サービスの認証に失敗しています",
        "high",
        "LLM 設定の API キー・接続先が有効かを確かめてください（期限切れ・権限不足・プロジェクトの取り違え）。",
    ),
    "timeout": (
        "時間内に終わっていません",
        "medium",
        "1回の処理が大きすぎる可能性があります。工程の入力（取り込んだ資料・添付）を絞るか、"
        "処理系の側で1回あたりの量を分ける修正が必要です。",
    ),
    "error": (
        "失敗しています",
        "medium",
        "エラーの内容を確かめてください。同じ原因で繰り返すなら処理系の不具合です（下の対話で修正案を聞けます）。",
    ),
}


def _fp(*parts: object) -> str:
    return hashlib.sha1(":".join(str(p) for p in parts).encode()).hexdigest()[:40]


def _f(kind, severity, title, detail="", suggestion="", product_id=None, action=None, count=1, key=()) -> dict:
    return {
        "fingerprint": _fp(kind, product_id, *key),
        "kind": kind,
        "severity": severity,
        "title": title,
        "detail": detail,
        "suggestion": suggestion,
        "product_id": product_id,
        "action": action,
        "count": count,
    }


def _detect_scheduler(tenant: str, now: dt.datetime) -> list[dict]:
    with session() as s:
        b = s.get(SystemBeat, "tick")
        oldest = s.execute(
            select(func.min(Product.created_at)).where(Product.tenant_id == tenant)
        ).scalar()  # 有無だけ見る
    act = {"type": "tick", "label": "いま1回、定期実行を動かす"}
    hint = (
        "Cloud Scheduler のジョブ（毎分 /internal/scheduler/tick を呼ぶ）が有効か、呼び出し用サービスアカウントに "
        "pf-agent を呼ぶ権限があるかを確かめてください。手元では PF_SCHEDULER=thread で動かします。"
    )
    if oldest is None:  # プロダクトのないテナントは定期実行を必要としない
        return []
    if b is None:  # 定期実行は毎分来るので、プロダクトがあるのに記録がないこと自体が問題
        return [
            _f(
                "scheduler",
                "high",
                "定期実行（tick）が一度も来ていません",
                "PM・担当・会議の定期実行が動きません。",
                hint,
                action=act,
                key=("never",),
            )
        ]
    if now - _aware(b.at) > dt.timedelta(minutes=TICK_STALE_MIN):
        return [
            _f(
                "scheduler",
                "high",
                f"定期実行（tick）が止まっています（最後は{_ago(b.at, now)}）",
                f"最後の記録：{b.detail}",
                hint,
                action=act,
                key=("stale",),
            )
        ]
    return []


def _detect_jobs(tenant: str, now: dt.datetime) -> list[dict]:
    since = now - dt.timedelta(hours=24)
    with session() as s:
        rows = s.execute(
            select(
                JobRun.id,
                JobRun.kind,
                JobRun.product_id,
                JobRun.status,
                JobRun.error,
                JobRun.params,
                JobRun.created_at,
                JobRun.started_at,
            )
            .where(JobRun.tenant_id == tenant, JobRun.created_at >= since)
            .order_by(JobRun.created_at.desc())
        ).all()
    out: list[dict] = []
    # 始まらないジョブ（実行の仕組み＝Cloud Run Jobs の起動に問題）
    waiting = [
        r
        for r in rows
        if r.status == "queued"
        and r.started_at is None
        and now - _aware(r.created_at) > dt.timedelta(minutes=QUEUE_STALE_MIN)
    ]
    if waiting:
        out.append(
            _f(
                "queue",
                "high",
                f"ジョブが始まりません（{len(waiting)} 件が {QUEUE_STALE_MIN} 分以上待ち）",
                "、".join(
                    f"{jobs.JOBS[r.kind].name if r.kind in jobs.JOBS else r.kind}（{r.id[:8]}）" for r in waiting[:5]
                ),
                "ジョブを動かす仕組み（Cloud Run Jobs の pf-autodev・実行用サービスアカウントの権限・同時実行の上限）"
                "を確かめてください。",
                count=len(waiting),
                key=("waiting",),
            )
        )
    # 種類・プロダクトごとに、最後に成功してからの失敗をまとめる（成功したら解決）
    groups: dict[tuple, list] = {}
    for r in rows:
        groups.setdefault((r.kind, r.product_id), []).append(r)
    for (kind, pid), rs in groups.items():
        fails = []
        for r in rs:  # 新しい順
            if r.status == "done":
                break
            if r.status == "failed":
                fails.append(r)
        by_cat: dict[str, list] = {}
        for r in fails:
            by_cat.setdefault(_category(r.error or ""), []).append(r)
        for cat, fs in by_cat.items():
            head, sev, hint = CATEGORY[cat]
            if cat == "error" and len(fs) >= 3:
                sev = "high"
            name = jobs.JOBS[kind].name if kind in jobs.JOBS else kind
            action = None
            if kind == "team" and pid:
                keys = sorted({k for r in fs for k in (r.params or {}).get("keys", [])})
                if keys:
                    action = {"type": "run_team", "label": "この担当をもう一度動かす", "product_id": pid, "keys": keys}
            out.append(
                _f(
                    "job" if cat in ("error", "timeout") else "llm",
                    sev,
                    f"「{name}」が{head}（最後に成功してから {len(fs)} 回）",
                    f"最新のエラー（{_ago(fs[0].created_at, now)}）：{(fs[0].error or '')[:400]}",
                    hint,
                    product_id=pid,
                    action=action,
                    count=len(fs),
                    key=(kind, cat),
                )
            )
    return out


def _detect_product(p: Product, now: dt.datetime) -> list[dict]:
    from .team import ACTIONABLE, KEYS, OPEN, PMS, name_of

    out: list[dict] = []
    if (p.cycle_state or "running") == "review":  # プロダクトレビュー中は止めているので、遅れ・止まりとは扱わない
        return out
    with session() as s:
        agents = {a.key: a for a in s.execute(select(TeamAgent).where(TeamAgent.product_id == p.id)).scalars()}
        issues = list(
            s.execute(select(AgentIssue).where(AgentIssue.product_id == p.id, AgentIssue.status.in_(OPEN))).scalars()
        )
        last: dict[int, IssueJournal] = {}
        counts: dict[int, int] = {}
        if issues:
            ids = [i.id for i in issues]
            for j in s.execute(
                select(IssueJournal).where(IssueJournal.issue_id.in_(ids)).order_by(IssueJournal.id)
            ).scalars():
                last[j.issue_id] = j
                counts[j.issue_id] = counts.get(j.issue_id, 0) + 1
        for x in (*agents.values(), *issues, *last.values()):
            s.expunge(x)
    today = now.astimezone(JST).date().isoformat()
    # 担当が拾っていない Issue（最後に書いたのが担当以外のまま、目安の時間を過ぎた）
    waiting: dict[str, list[AgentIssue]] = {}
    for i in issues:
        if i.status not in ACTIONABLE:
            continue
        j = last.get(i.id)
        if j is not None and j.author == i.assignee:
            continue
        since = _aware(j.created_at if j else i.created_at)
        limit = WAIT_MIN["pm" if i.assignee in PMS else "stage"]
        if now - since > dt.timedelta(minutes=limit):
            waiting.setdefault(i.assignee, []).append(i)
    for key, iss in waiting.items():
        a = agents.get(key)
        oldest = min(_aware(last.get(i.id).created_at if last.get(i.id) else i.created_at) for i in iss)
        sev = "high" if now - oldest > dt.timedelta(hours=6) else "medium"
        nums = "・".join(f"#{i.number}" for i in iss[:8])
        if a is not None and not a.enabled:
            out.append(
                _f(
                    "agent",
                    "high",
                    f"{name_of(key)}が止まっているのに Issue を {len(iss)} 件抱えています",
                    f"{nums}。止めている間は誰も拾いません。",
                    "エージェントの組織で再開するか、Issue を別の担当に付け替えてください。",
                    p.id,
                    {"type": "enable_agent", "label": f"{name_of(key)}を再開する", "product_id": p.id, "key": key},
                    len(iss),
                    key=("disabled", key),
                )
            )
            continue
        out.append(
            _f(
                "issue",
                sev,
                f"{name_of(key)}が Issue を拾っていません（{len(iss)} 件・最長 {_ago(oldest, now)}から）",
                f"{nums}。定期実行で拾うはずの時間を過ぎています。",
                "いま動かして様子を見てください。繰り返すなら、担当の実行が失敗していないか（ジョブ）を確かめます。",
                p.id,
                {"type": "run_team", "label": f"{name_of(key)}をいま動かす", "product_id": p.id, "keys": [key]},
                len(iss),
                key=("wait", key),
            )
        )
    # 往復し続ける Issue
    for i in issues:
        n = counts.get(i.id, 0)
        if n >= PINGPONG:
            out.append(
                _f(
                    "issue",
                    "medium",
                    f"#{i.number} のやり取りが {n} 回続いています",
                    f"「{i.subject}」（{name_of(i.assignee)}）。エージェント同士で決めきれていない可能性があります。",
                    "領域の PM に判断させるか、PdM が PM との対話で決めて伝えてください。",
                    p.id,
                    None,
                    n,
                    key=("pingpong", i.number),
                )
            )
    overdue = [i for i in issues if i.due_date and i.due_date < today]
    if overdue:
        out.append(
            _f(
                "issue",
                "medium",
                f"期日を過ぎた Issue が {len(overdue)} 件あります",
                "・".join(f"#{i.number}（{i.due_date}）" for i in overdue[:8]),
                "PM に期日を見直させるか、担当をいま動かしてください。",
                p.id,
                None,
                len(overdue),
                key=("overdue",),
            )
        )
    stale = [i for i in issues if now - _aware(i.updated_at) > dt.timedelta(days=STALE_DAYS)]
    if stale:
        out.append(
            _f(
                "issue",
                "low",
                f"{STALE_DAYS} 日以上動いていない Issue が {len(stale)} 件あります",
                "・".join(f"#{i.number}" for i in stale[:8]),
                "要らなくなったものは PM に却下させてください。",
                p.id,
                None,
                len(stale),
                key=("stale",),
            )
        )
    # 予定の時刻を過ぎても動いていない（tick が拾えていない）・予定が読めない・詰まっている
    missed = [
        k
        for k, a in agents.items()
        if a.enabled and a.next_run_at is not None and now - _aware(a.next_run_at) > dt.timedelta(minutes=MISSED_MIN)
    ]
    if missed:
        out.append(
            _f(
                "agent",
                "high",
                f"予定の時刻を過ぎても動いていないエージェントが {len(missed)} 人います",
                "、".join(name_of(k) for k in missed[:10]),
                "定期実行（tick）が来ていないか、予定の取り合いで抜けています。予定を立て直してください。",
                p.id,
                {"type": "reschedule", "label": "予定を立て直す", "product_id": p.id, "keys": missed},
                len(missed),
                key=("missed",),
            )
        )
    broken = [k for k, a in agents.items() if a.enabled and a.next_run_at is None]
    if broken:
        out.append(
            _f(
                "agent",
                "medium",
                f"次の予定がないエージェントが {len(broken)} 人います",
                "、".join(name_of(k) for k in broken[:10]),
                "cron の書き方が読めない可能性があります。エージェントの組織で予定を直してください。",
                p.id,
                {"type": "reschedule", "label": "予定を立て直す", "product_id": p.id, "keys": broken},
                len(broken),
                key=("noschedule",),
            )
        )
    for k, a in agents.items():
        if k in KEYS and (a.report or {}).get("health") == "red":
            out.append(
                _f(
                    "agent",
                    "medium",
                    f"{name_of(k)}が詰まっていると報告しています",
                    (a.report or {}).get("summary", "")[:300],
                    "報告の中身を領域の PM に確かめさせてください。",
                    p.id,
                    {"type": "run_team", "label": f"{name_of(k)}をいま動かす", "product_id": p.id, "keys": [k]},
                    1,
                    key=("red", k),
                )
            )
    return out


def detect(tenant: str, now: dt.datetime | None = None) -> dict:
    """問題を見つけて記録する。新しく出た・ぶり返した重い問題は PdM に知らせる。見つからなくなった問題は解決にする。"""
    now = now or _now()
    with session() as s:
        products = list(
            s.execute(select(Product).where(Product.tenant_id == tenant, Product.status != "stopped")).scalars()
        )
        for p in products:
            s.expunge(p)
    found = _detect_scheduler(tenant, now) + _detect_jobs(tenant, now)
    for p in products:
        found += _detect_product(p, now)
    names = {p.id: p.name for p in products}
    alerts: list[PlatformFinding] = []
    seen: set[str] = set()
    with session() as s:
        have = {
            f.fingerprint: f
            for f in s.execute(select(PlatformFinding).where(PlatformFinding.tenant_id == tenant)).scalars()
        }
        for d in found:
            if d["fingerprint"] in seen:
                continue
            seen.add(d["fingerprint"])
            f = have.get(d["fingerprint"])
            fresh = f is None or f.status == "resolved"
            if f is None:
                f = PlatformFinding(tenant_id=tenant, fingerprint=d["fingerprint"], first_at=now)
                s.add(f)
            if fresh:
                f.status, f.resolved_at, f.first_at = "open", None, now
            for k in ("kind", "severity", "title", "detail", "suggestion", "product_id", "action", "count"):
                setattr(f, k, d[k])
            f.last_at = now
            if fresh and f.severity == "high":
                alerts.append(f)
        resolved = 0
        for fp, f in have.items():
            if fp not in seen and f.status != "resolved":
                f.status, f.resolved_at = "resolved", now
                resolved += 1
        s.flush()
        for f in alerts:
            where = f"（{names[f.product_id]}）" if f.product_id in names else ""
            # PdM への話しかけは4つの型だけ：対処があれば合意依頼、なければ相談
            if f.action:
                ask, ask_label = "agree_next", "ネクストアクションへの合意依頼"
                msg = f"【{ask_label}】{f.title}{where}\n{f.suggestion}\n→「{f.action['label']}」を実行してよいですか。"
            else:
                ask, ask_label = "consult", "相談"
                msg = (f"【{ask_label}】{f.title}{where}\n{f.suggestion}\n→ どう対処するか、"
                       f"チャットで @プラットフォーム に返事をしてください。")
            s.add(
                PlatformMessage(
                    tenant_id=tenant,
                    role="platform",
                    author=NAME,
                    findings=[f.id],
                    text=msg,
                )
            )
            s.add(
                AssistantMessage(
                    tenant_id=tenant,
                    user=None,
                    product_id=f.product_id,
                    role="agent",
                    agent="platform",
                    text=msg,
                    context={"kind": "platform", "label": "プラットフォーム", "finding": f.id, "ask": ask,
                             "ask_label": ask_label},
                    actions=[
                        {"id": f"f{f.id}", "type": "platform_act", "status": "pending", "by": "platform",
                         "title": f"対処を実行する：{f.action['label']}", "before": f.title,
                         "after": f.action["label"], "args": {"finding": f.id}, "reason": f.suggestion}
                    ]
                    if f.action
                    else [],
                )
            )
        s.commit()
    return {"found": len(seen), "alerts": len(alerts), "resolved": resolved}


def tick(now: dt.datetime | None = None) -> int:
    """定期実行から呼ぶ。テナントごとの間隔（画面で決める。既定5分）が来たテナントだけを確かめる。"""
    from . import schedule
    from .team import beat

    now = now or _now()
    with session() as s:
        tenants = list(s.execute(select(Product.tenant_id).distinct()).scalars())
    done = 0
    for t in tenants:
        try:
            if not schedule.platform_due(t, now):
                continue
            detect(t, now)
            schedule.platform_ran(t, now)
            done += 1
        except Exception:  # noqa: BLE001, S112  1つのテナントの失敗で他を止めない
            continue
    if done:
        beat("platform", f"{done} テナントを確かめました")
    return done


# ---------------- 見せる ----------------
def finding_dict(f: PlatformFinding, names: dict[str, str] | None = None) -> dict:
    return {
        "id": f.id,
        "product_id": f.product_id,
        "product_name": (names or {}).get(f.product_id or "", ""),
        "kind": f.kind,
        "severity": f.severity,
        "severity_label": SEVERITY.get(f.severity, f.severity),
        "title": f.title,
        "detail": f.detail,
        "suggestion": f.suggestion,
        "action": f.action,
        "count": f.count,
        "status": f.status,
        "first_at": _iso(f.first_at),
        "last_at": _iso(f.last_at),
        "resolved_at": _iso(f.resolved_at),
    }


def message_dict(m: PlatformMessage) -> dict:
    return {
        "id": m.id,
        "role": m.role,
        "author": m.author,
        "text": m.text,
        "findings": m.findings or [],
        "proposals": m.proposals or [],
        "created_at": _iso(m.created_at),
    }


def _names(tenant: str) -> dict[str, str]:
    with session() as s:
        return dict(s.execute(select(Product.id, Product.name).where(Product.tenant_id == tenant)).all())


def findings(tenant: str, include_resolved: int = 20) -> list[dict]:
    names = _names(tenant)
    order = {"high": 0, "medium": 1, "low": 2}
    with session() as s:
        live = list(
            s.execute(
                select(PlatformFinding).where(PlatformFinding.tenant_id == tenant, PlatformFinding.status != "resolved")
            ).scalars()
        )
        done = list(
            s.execute(
                select(PlatformFinding)
                .where(PlatformFinding.tenant_id == tenant, PlatformFinding.status == "resolved")
                .order_by(PlatformFinding.resolved_at.desc())
                .limit(include_resolved)
            ).scalars()
        )
        live.sort(key=lambda f: (f.status != "open", order.get(f.severity, 3), -f.last_at.timestamp()))
        return [finding_dict(f, names) for f in live + done]


def summary(tenant: str) -> dict:
    """レールの印（数秒ごとに読む）。AI も検知も動かさない。"""
    with session() as s:
        rows = s.execute(
            select(PlatformFinding.severity, func.count())
            .where(PlatformFinding.tenant_id == tenant, PlatformFinding.status == "open")
            .group_by(PlatformFinding.severity)
        ).all()
        b = s.get(SystemBeat, "tick")
    by = dict(rows)
    return {"open": sum(by.values()), "high": by.get("high", 0), "tick_at": _iso(b.at) if b else None}


def status(tenant: str, now: dt.datetime | None = None) -> dict:
    """いまの稼働状況：定期実行・ジョブ（24時間）・プロダクトごとのエージェント。"""
    from .team import KEYS, OPEN, overview

    now = now or _now()
    since = now - dt.timedelta(hours=24)
    with session() as s:
        beats = {b.name: {"at": _iso(b.at), "detail": b.detail} for b in s.execute(select(SystemBeat)).scalars()}
        job_rows = s.execute(
            select(JobRun.kind, JobRun.status, func.count())
            .where(JobRun.tenant_id == tenant, JobRun.created_at >= since)
            .group_by(JobRun.kind, JobRun.status)
        ).all()
        running = s.execute(
            select(JobRun.id, JobRun.kind, JobRun.product_id, JobRun.status, JobRun.created_at)
            .where(JobRun.tenant_id == tenant, JobRun.status.in_(("queued", "running")))
            .order_by(JobRun.created_at)
        ).all()
        products = list(
            s.execute(
                select(Product)
                .where(Product.tenant_id == tenant, Product.status != "stopped")
                .order_by(Product.created_at)
            ).scalars()
        )
        for p in products:
            s.expunge(p)
        open_issues = dict(
            s.execute(
                select(AgentIssue.product_id, func.count())
                .where(AgentIssue.tenant_id == tenant, AgentIssue.status.in_(OPEN))
                .group_by(AgentIssue.product_id)
            ).all()
        )
    kinds: dict[str, dict] = {}
    for kind, st, n in job_rows:
        k = kinds.setdefault(
            kind,
            {
                "kind": kind,
                "name": jobs.JOBS[kind].name if kind in jobs.JOBS else kind,
                "done": 0,
                "failed": 0,
                "running": 0,
                "other": 0,
            },
        )
        bucket = st if st in ("done", "failed") else "running" if st in ("queued", "running") else "other"
        k[bucket] += n
    names = {p.id: p.name for p in products}
    prods = []
    for p in products:
        ov = overview(p)
        st_count = {"working": 0, "stuck": 0, "idle": 0, "off": 0}
        for a in ov["agents"]:
            k = "off" if not a["enabled"] else a["state"]
            st_count[k] = st_count.get(k, 0) + 1
        nxt = [a["next_run_at"] for a in ov["agents"] if a["enabled"] and a["next_run_at"] and a["key"] in KEYS]
        prods.append(
            {
                "id": p.id,
                "name": p.name,
                "agents": st_count,
                "open_issues": open_issues.get(p.id, 0),
                "next_run_at": min(nxt) if nxt else None,
                "meeting": ov["meeting"],
            }
        )
    tick_at = beats.get("tick", {}).get("at")
    healthy = tick_at is not None and now - dt.datetime.fromisoformat(tick_at) <= dt.timedelta(minutes=TICK_STALE_MIN)
    return {
        "now": _iso(now),
        "scheduler": {"healthy": healthy, "beats": beats},
        "jobs": sorted(kinds.values(), key=lambda k: -(k["failed"] * 1000 + k["done"] + k["running"])),
        "running": [
            {
                "id": r.id,
                "kind": r.kind,
                "name": jobs.JOBS[r.kind].name if r.kind in jobs.JOBS else r.kind,
                "product_name": names.get(r.product_id or "", ""),
                "status": r.status,
                "created_at": _iso(r.created_at),
            }
            for r in running
        ],
        "products": prods,
    }


def messages(tenant: str, limit: int = 60) -> list[dict]:
    with session() as s:
        rows = list(
            s.execute(
                select(PlatformMessage)
                .where(PlatformMessage.tenant_id == tenant)
                .order_by(PlatformMessage.id.desc())
                .limit(limit)
            ).scalars()
        )
        return [message_dict(m) for m in reversed(rows)]


def workspace(tenant: str) -> dict:
    detect(tenant)
    return {
        "status": status(tenant),
        "findings": findings(tenant),
        "messages": messages(tenant),
        "summary": summary(tenant),
    }


# ---------------- 対話 ----------------
class ProposalOut(BaseModel):
    kind: str = Field(description="ops（運用で今すぐできる対処）か code（処理系＝ファクトリーのコードの修正案）")
    title: str
    detail: str = Field(description="何を・どこを・なぜ。code なら直す場所と直し方の方針")


class PlatformReply(BaseModel):
    reply: str
    proposals: list[ProposalOut] = Field(default_factory=list)
    findings: list[int] = Field(default_factory=list, description="答えで触れた問題の id")


def _say(
    tenant: str, role: str, author: str, text: str, found: list[int] | None = None, proposals: list[dict] | None = None
) -> dict:
    with session() as s:
        m = PlatformMessage(
            tenant_id=tenant, role=role, author=author, text=text, findings=found or [], proposals=proposals or []
        )
        s.add(m)
        s.commit()
        return message_dict(m)


def talk(tenant: str, user: str, text: str) -> dict:
    text = text.strip()
    if not text:
        raise PlatformError(422, "本文が空です")
    detect(tenant)
    mine = _say(tenant, "pdm", user, text)
    fs = [f for f in findings(tenant, include_resolved=5)]
    live = [f for f in fs if f["status"] != "resolved"]
    conn = llmconf.resolve(tenant)
    from . import agentrun

    prep = agentrun.prepare(tenant, None, "platform")
    if conn.provider == "stub":
        llm._record("stub", 0, 0)
        if live:
            body = f"（スタブ）未解決の問題は {len(live)} 件です。重いものから：\n" + "\n".join(
                f"- {f['title']}" + (f"（{f['product_name']}）" if f["product_name"] else "") for f in live[:3]
            )
        else:
            body = (
                "（スタブ）いま見つかっている問題はありません。"
                "定期実行は動いていて、失敗し続けているジョブ・拾われていない Issue もありません。"
            )
        out = PlatformReply(
            reply=body,
            proposals=[ProposalOut(kind="ops", title=f["title"][:80], detail=f["suggestion"]) for f in live[:3]],
            findings=[f["id"] for f in live[:3]],
        )
    else:
        st = status(tenant)
        prompt = (
            prep.header()
            + "\n\nあなたはプロダクト開発ファクトリーのプラットフォームエージェントです。PdM（人）と直接話します。"
            "プロダクトの中身ではなく、ファクトリーの処理系"
            "（定期実行・ジョブ・エージェントの実行・Issue の流れ・LLM 接続）"
            "が正しく動いているかを見る役割です。\n"
            "- reply：日本語で、事実（下の記録）に基づいて短く直接答える。推測は推測と書く。前置きや称賛は書かない。\n"
            "- proposals：対処の提案。ops は運用で今すぐできること（再実行・設定の変更・予定の見直し）、"
            "code は処理系のコードの修正案（直す場所と方針）。自分では直さない。\n"
            "- findings：答えで触れた問題の id。\n\n"
            "## 定期実行\n"
            + "\n".join(f"- {k}：{v['at']}（{v['detail']}）" for k, v in st["scheduler"]["beats"].items())
            + "\n\n## ジョブ（24時間）\n"
            + "\n".join(
                f"- {j['name']}：成功 {j['done']}・失敗 {j['failed']}・実行中 {j['running']}" for j in st["jobs"]
            )
            + "\n\n## プロダクトごとのエージェント\n"
            + "\n".join(
                f"- {p['name']}：{p['agents']}・終わっていない Issue {p['open_issues']}" for p in st["products"]
            )
            + "\n\n## 問題（id・重さ・状態・題名・詳細・対処の案）\n"
            + "\n".join(
                f"- {f['id']}［{f['severity']}・{f['status']}］{f['title']}｜{f['detail'][:300]}｜"
                f"{f['suggestion'][:200]}"
                for f in fs[:30]
            )
            + "\n\n## これまでの対話\n"
            + "\n".join(f"{'PdM' if m['role'] == 'pdm' else NAME}：{m['text'][:600]}" for m in messages(tenant, 12))
        )
        out = agentrun.think(conn, prep, prompt, PlatformReply)
    if not prep.can("propose_fix"):
        out.proposals = []
    ids = {f["id"] for f in fs}
    reply = _say(
        tenant,
        "platform",
        NAME,
        out.reply,
        [i for i in out.findings if i in ids],
        [p.model_dump() for p in out.proposals[:6]],
    )
    return {"mine": mine, "reply": reply}


# ---------------- 対処（PdM の承認で実行する安全なもの） ----------------
def _product(tenant: str, pid: str | None) -> Product:
    with session() as s:
        p = s.get(Product, pid) if pid else None
        if p is None or p.tenant_id != tenant:
            raise PlatformError(404, "プロダクトがありません")
        s.expunge(p)
        return p


def act(tenant: str, user: str, finding_id: int) -> dict:
    from . import agents as sched
    from . import team

    with session() as s:
        f = s.get(PlatformFinding, finding_id)
        if f is None or f.tenant_id != tenant:
            raise PlatformError(404, "その問題はありません")
        if f.status == "resolved":
            raise PlatformError(409, "もう解決しています")
        a = dict(f.action or {})
        title = f.title
    if not a:
        raise PlatformError(409, "この問題には、ここから実行できる対処がありません")
    t = a.get("type")
    if t == "tick":
        n = len(sched.tick() + team.tick())
        done = f"定期実行を1回動かしました（起動 {n} 件）"
    elif t == "run_team":
        p = _product(tenant, a.get("product_id"))
        keys = [k for k in a.get("keys", []) if k in team.KEYS]
        if not keys:
            raise PlatformError(409, "動かす担当がいません")
        team.start(p, user, keys, reason="プラットフォームの提案")
        done = f"{'、'.join(team.name_of(k) for k in keys)}を動かしました"
    elif t == "enable_agent":
        p = _product(tenant, a.get("product_id"))
        team.edit_agent(p, a["key"], None, None, True)
        done = f"{team.name_of(a['key'])}を再開しました"
    elif t == "reschedule":
        p = _product(tenant, a.get("product_id"))
        now = _now()
        fixed = []
        with session() as s:
            for ag in s.execute(
                select(TeamAgent).where(TeamAgent.product_id == p.id, TeamAgent.key.in_(a.get("keys", [])))
            ).scalars():
                try:
                    ag.next_run_at = cron.next_after(ag.cron, now, ag.timezone)
                    fixed.append(ag.key)
                except cron.CronError:
                    continue
            s.commit()
        done = f"予定を立て直しました（{len(fixed)} 人）"
    else:
        raise PlatformError(409, "知らない対処です")
    with session() as s:
        f = s.get(PlatformFinding, finding_id)
        f.status = "ack"
        s.commit()
    msg = _say(tenant, "platform", NAME, f"PdM の承認で実行しました：{done}（{title}）", [finding_id])
    return {"done": done, "message": msg}


def set_status(tenant: str, finding_id: int, st: str) -> dict:
    if st not in ("open", "ack", "resolved"):
        raise PlatformError(422, "状態は open・ack・resolved のどれかです")
    with session() as s:
        f = s.get(PlatformFinding, finding_id)
        if f is None or f.tenant_id != tenant:
            raise PlatformError(404, "その問題はありません")
        f.status = st
        f.resolved_at = _now() if st == "resolved" else None
        s.commit()
        return finding_dict(f, _names(tenant))
