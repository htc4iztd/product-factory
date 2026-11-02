"""エージェントの定期実行の予定：画面で読み書きしやすい形にする（cron は内部の表し方）。

- view：プロダクトのエージェント・会議の予定、次の数回、これから24時間の時間割（1時間ごとの回数）
- bulk：まとめて同じ予定にする・止める／動かす
- overview：テナントのすべてのプロダクトの予定を並べる
- プラットフォームの見回りの間隔（テナントごと。既定5分）
毎分の呼び出し（Cloud Scheduler）は固定で、各予定はそのたびに時刻が来たかを見る。
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import select

from . import cron
from .db import Product, TeamAgent, TenantSetting, session
from .team import DOMAIN, MEETING, PM_SYNC, PMS, TeamError, _iso, _now, edit_agent, ensure, name_of

GROUPS = (
    ("pm", "PM", PMS),
    ("pmsync", "PM 同士の連絡", (PM_SYNC,)),
    ("biz", "事業の担当（①〜⑤）", DOMAIN["pm_biz"]),
    ("design", "要求・設計の担当（⑥〜⑪）", DOMAIN["pm_design"]),
    ("impl", "構築の担当（⑫〜⑬）", DOMAIN["pm_impl"]),
    ("release", "リリースエージェント（⑭・サイクルの外）", ("s14",)),
    ("meeting", "振り返りの会議", (MEETING,)),
)
GROUP_OF = {k: g for g, _, keys in GROUPS for k in keys}
WHAT = {
    "pm": "担当の状況を集める（変化か PM 宛ての Issue があるときだけ AI を使う）",
    "stage": "自分宛ての Issue を確かめる（手を動かす Issue があるときだけ AI を使う）",
    "meeting": "PM がレポートと突き合わせを準備する",
    "release": "自分宛ての Issue があるときだけ動く"
    "（リリースの定義・実行は、プロダクトレビューのあとのリリースで動く）",
    "pmsync": "事業・設計・実装 PM が、他の領域に関わること（依存・食い違い・確認）を掲示板で伝え合う"
    "（前回から変化があるときだけ AI を使う）",
}
HOURS = 24
PLATFORM_DEFAULT = 5
PLATFORM_CHOICES = (1, 5, 10, 15, 30, 60)


def preview(expr: str, tz: str = "Asia/Tokyo") -> dict:
    expr = " ".join(expr.split())
    try:
        nxt = cron.next_runs(expr, _now(), 3, tz)
    except cron.CronError as e:
        raise TeamError(422, f"読めない予定です：{e}") from None
    gap = (nxt[1] - nxt[0]).total_seconds() / 60 if len(nxt) > 1 else None
    return {
        "cron": expr,
        "label": cron.describe(expr),
        "next": [_iso(t) for t in nxt],
        "warning": "10分より短い間隔は、AI の利用が増えます" if gap is not None and gap < 10 else "",
    }


def _runs(expr: str, tz: str, start: dt.datetime) -> list[int]:
    """start（時の頭）から24時間に動く時刻（start からの分）。"""
    try:
        runs = cron.next_runs(expr, start - dt.timedelta(minutes=1), 60 * HOURS, tz, start + dt.timedelta(hours=HOURS))
    except cron.CronError:
        return []
    return [m for m in (int((t - start).total_seconds() // 60) for t in runs) if 0 <= m < 60 * HOURS]


def _hours(expr: str, tz: str, start: dt.datetime) -> list[int]:
    """start（時の頭）から24時間、1時間ごとに何回動くか。"""
    counts = [0] * HOURS
    for m in _runs(expr, tz, start):
        counts[m // 60] += 1
    return counts


def view(product: Product) -> dict:
    ensure(product)
    now = _now()
    start = now.replace(minute=0, second=0, microsecond=0)
    with session() as s:
        rows = {a.key: a for a in s.execute(select(TeamAgent).where(TeamAgent.product_id == product.id)).scalars()}
        for a in rows.values():
            s.expunge(a)
    agents = []
    for g, label, keys in GROUPS:
        for k in keys:
            a = rows[k]
            try:
                nxt = [_iso(t) for t in cron.next_runs(a.cron, now, 3, a.timezone)] if a.enabled else []
            except cron.CronError:
                nxt = []
            agents.append(
                {
                    "key": k,
                    "name": name_of(k),
                    "group": g,
                    "group_label": label,
                    "what": WHAT[
                        "meeting" if k == MEETING else "pmsync" if k == PM_SYNC else "pm" if k in PMS
                        else "release" if k == "s14" else "stage"
                    ],
                    "cron": a.cron,
                    "label": cron.describe(a.cron),
                    "timezone": a.timezone,
                    "enabled": a.enabled,
                    "next": nxt,
                    "last_run_at": _iso(a.last_run_at),
                    "hours": _hours(a.cron, a.timezone, start) if a.enabled else [0] * HOURS,
                    "runs": _runs(a.cron, a.timezone, start) if a.enabled else [],
                }
            )
    return {
        "start": _iso(start),
        "now": _iso(now),
        "hours": HOURS,
        "groups": [{"key": g, "label": lb} for g, lb, _ in GROUPS],
        "agents": agents,
        "platform": platform_setting(product.tenant_id),
    }


def bulk(product: Product, keys: list[str], expr: str | None, enabled: bool | None) -> dict:
    if not keys:
        raise TeamError(422, "変えるエージェントを選んでください")
    bad = [k for k in keys if k not in GROUP_OF]
    if bad:
        raise TeamError(404, f"いないエージェント：{'、'.join(bad)}")
    if expr is not None:
        preview(expr)  # 先に全部を確かめてから変える
    for k in dict.fromkeys(keys):
        edit_agent(product, k, None, " ".join(expr.split()) if expr is not None else None, enabled)
    return view(product)


def overview(tenant: str) -> list[dict]:
    """すべてのプロダクトの予定（グループごとの予定・止めている数・次に動く時刻）。"""
    now = _now()
    with session() as s:
        products = list(
            s.execute(
                select(Product)
                .where(Product.tenant_id == tenant, Product.status != "stopped")
                .order_by(Product.created_at)
            ).scalars()
        )
        agents = list(s.execute(select(TeamAgent).where(TeamAgent.tenant_id == tenant)).scalars())
        for x in (*products, *agents):
            s.expunge(x)
    by: dict[str, list[TeamAgent]] = {}
    for a in agents:
        by.setdefault(a.product_id, []).append(a)
    out = []
    for p in products:
        mine = {a.key: a for a in by.get(p.id, [])}
        groups = []
        for g, label, keys in GROUPS:
            rows = [mine[k] for k in keys if k in mine]
            on = [a for a in rows if a.enabled]
            labels = sorted({cron.describe(a.cron) for a in on})
            nxt = min((_aware(a.next_run_at) for a in on if a.next_run_at), default=None)
            groups.append(
                {
                    "key": g,
                    "label": label,
                    "schedules": labels,
                    "stopped": len(rows) - len(on),
                    "total": len(rows),
                    "next_run_at": _iso(nxt) if nxt and nxt > now else _iso(nxt),
                }
            )
        out.append({"id": p.id, "name": p.name, "groups": groups, "set_up": bool(mine)})
    return out


def _aware(t: dt.datetime) -> dt.datetime:
    return t if t.tzinfo else t.replace(tzinfo=dt.UTC)


# ---------------- プラットフォームの見回り ----------------
def _setting(tenant: str, name: str) -> dict | None:
    with session() as s:
        r = s.get(TenantSetting, (tenant, name))
        return dict(r.value) if r and r.value else None


def _put(tenant: str, name: str, value: dict) -> None:
    with session() as s:
        r = s.get(TenantSetting, (tenant, name))
        if r is None:
            r = TenantSetting(tenant_id=tenant, name=name)
            s.add(r)
        r.value = value
        s.commit()


def platform_every(tenant: str) -> int:
    v = _setting(tenant, "platform")
    return int((v or {}).get("every_min") or PLATFORM_DEFAULT)


def platform_setting(tenant: str) -> dict:
    v = _setting(tenant, "platform") or {}
    every = int(v.get("every_min") or PLATFORM_DEFAULT)
    return {
        "every_min": every,
        "label": f"{every}分ごと",
        "last_at": v.get("last_at"),
        "choices": list(PLATFORM_CHOICES),
        "what": "稼働の問題を見回る（AI は使わない）",
    }


def set_platform_every(tenant: str, every: int) -> dict:
    if every not in PLATFORM_CHOICES:
        raise TeamError(422, f"見回りの間隔は {'・'.join(map(str, PLATFORM_CHOICES))} 分から選んでください")
    v = _setting(tenant, "platform") or {}
    _put(tenant, "platform", {**v, "every_min": every})
    return platform_setting(tenant)


def platform_due(tenant: str, now: dt.datetime) -> bool:
    v = _setting(tenant, "platform") or {}
    last = v.get("last_at")
    every = int(v.get("every_min") or PLATFORM_DEFAULT)
    return last is None or now - dt.datetime.fromisoformat(last) >= dt.timedelta(minutes=every) - dt.timedelta(
        seconds=5
    )


def platform_ran(tenant: str, now: dt.datetime) -> None:
    v = _setting(tenant, "platform") or {}
    _put(tenant, "platform", {**v, "last_at": now.isoformat()})
