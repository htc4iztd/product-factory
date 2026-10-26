"""cron の書き方（分 時 日 月 曜日 の5つ）を読み、次に動く時刻を求める。

使える書き方：* / 数字 / a-b / a,b / */n / a-b/n。曜日は 0〜7（0 と 7 が日曜）。
日と曜日の両方を指定したときは、どちらかに合えば動く（一般的な cron と同じ）。
"""
from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

RANGES = ((0, 59), (0, 23), (1, 31), (1, 12), (0, 7))
NAMES = ("分", "時", "日", "月", "曜日")


class CronError(ValueError):
    pass


def _part(text: str, lo: int, hi: int, name: str) -> set[int]:
    out: set[int] = set()
    for item in text.split(","):
        step = 1
        if "/" in item:
            item, s = item.split("/", 1)
            if not s.isdigit() or int(s) == 0:
                raise CronError(f"{name}の間隔「{s}」が読めません")
            step = int(s)
        if item == "*":
            a, b = lo, hi
        elif "-" in item:
            x, y = item.split("-", 1)
            if not (x.isdigit() and y.isdigit()):
                raise CronError(f"{name}の範囲「{item}」が読めません")
            a, b = int(x), int(y)
        elif item.isdigit():
            a = b = int(item)
            if step > 1:
                b = hi
        else:
            raise CronError(f"{name}の「{item}」が読めません")
        if not (lo <= a <= hi and lo <= b <= hi and a <= b):
            raise CronError(f"{name}は {lo}〜{hi} で書いてください")
        out.update(range(a, b + 1, step))
    return out


def parse(expr: str) -> tuple[set[int], ...]:
    parts = expr.split()
    if len(parts) != 5:
        raise CronError("cron は「分 時 日 月 曜日」の5つを空白で区切って書いてください（例：0 9 * * 1）")
    fields = tuple(_part(p, lo, hi, n) for p, (lo, hi), n in zip(parts, RANGES, NAMES, strict=True))
    dow = {d % 7 for d in fields[4]}
    return (*fields[:4], dow)


def next_after(expr: str, after: dt.datetime, tz: str = "Asia/Tokyo") -> dt.datetime:
    """after より後で、最初に動く時刻（UTC）。"""
    minute, hour, dom, month, dow = parse(expr)
    parts = expr.split()
    dom_any, dow_any = parts[2] == "*", parts[4] == "*"
    zone = ZoneInfo(tz)
    t = after.astimezone(zone).replace(second=0, microsecond=0) + dt.timedelta(minutes=1)
    limit = t + dt.timedelta(days=366 * 5)
    while t < limit:
        if t.month not in month:
            t = (t.replace(day=1, hour=0, minute=0) + dt.timedelta(days=32)).replace(day=1)
            continue
        wd = (t.weekday() + 1) % 7   # 日曜を 0 にする
        if dom_any or dow_any:
            day_ok = (dom_any or t.day in dom) and (dow_any or wd in dow)
        else:
            day_ok = t.day in dom or wd in dow
        if not day_ok:
            t = t.replace(hour=0, minute=0) + dt.timedelta(days=1)
            continue
        if t.hour not in hour:
            t = t.replace(minute=0) + dt.timedelta(hours=1)
            continue
        if t.minute not in minute:
            t += dt.timedelta(minutes=1)
            continue
        return t.astimezone(dt.UTC)
    raise CronError("この cron では、この先5年のうちに動く時刻がありません")


def describe(expr: str) -> str:
    """よく使う形だけ日本語にする（それ以外は式のまま）。"""
    try:
        m, h, d, mo, w = expr.split()
    except ValueError:
        return expr
    days = "日月火水木金土日"
    if m.isdigit() and h.isdigit() and mo == "*":
        at = f"{int(h)}:{int(m):02d}"
        if d == "*" and w == "*":
            return f"毎日 {at}"
        if d == "*" and w == "1-5":
            return f"平日 {at}"
        if d == "*" and w.isdigit():
            return f"毎週{days[int(w)]}曜 {at}"
        if d.isdigit() and w == "*":
            return f"毎月{int(d)}日 {at}"
    if m.isdigit() and h == "*" and d == mo == w == "*":
        return f"毎時 {int(m)}分"
    return expr
