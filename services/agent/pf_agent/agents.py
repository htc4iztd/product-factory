"""自律エージェント（AG-n）：cron の時刻に決めた仕事を動かし、見つけたことを提案として受け箱に出す。

仕事の種類
- review：工程の見直し。選んだ工程を上流の最新版と突き合わせ、食い違い・抜け・古くなった前提を探す
- custom：自由な指示。指示に沿って選んだ工程を読み、提案する
- research：リサーチライブラリの更新ジョブを動かす
- report：報告資料（RP-n）を今の中身で作り直す
提案（AgentFinding）は人が「採用（項目に入れる）・却下・確認済み」にするか、返信して AI と詰める。
返信には AI が答え、必要なら案を直す。AI が工程の値を直接書き換えることはない（採用したときだけ入る）。

時刻の判定は tick()。Cloud Scheduler が数分ごとに /internal/scheduler/tick を呼ぶ（手元ではスレッドで回せる）。
同じ予定を二重に動かさないよう、次の時刻を書き換えられた方だけが動かす。
"""
from __future__ import annotations

import datetime as dt
import json
import os
import threading
import time

from pydantic import BaseModel
from sqlalchemy import func, select, update

from . import cron, jobs, llm, llmconf, repo, reports, research
from . import frameworks as fx
from .db import AgentFinding, AgentSchedule, JobRun, Notice, Product, session
from .stages import STAGE_BY_ID

TASKS = {"review": "工程の見直し", "custom": "自由な指示", "research": "リサーチライブラリの更新",
         "report": "報告資料の作り直し"}
SEVERITY = ("info", "warn", "action")

jobs.JOBS["agent"] = jobs.JobDef(
    "agent",
    "自律エージェントの実行",
    "予定（cron）や「今すぐ動かす」で、工程を読み、食い違い・抜け・指示に沿った改善を探して提案として受け箱に出す。",
    "自律エージェントの予定・「今すぐ動かす」",
    20,
)


class AgentError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


class PropOut(BaseModel):
    field: str
    value: str      # list は改行区切り、table などは JSON
    reason: str


class FindingOut(BaseModel):
    stage: str
    severity: str
    title: str
    body: str
    proposals: list[PropOut]


class FindingsOut(BaseModel):
    findings: list[FindingOut]


class ReplyOut(BaseModel):
    reply: str
    revise: bool
    proposals: list[PropOut]


def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def _iso(t: dt.datetime | None) -> str | None:
    if t is None:
        return None
    return (t if t.tzinfo else t.replace(tzinfo=dt.UTC)).isoformat()


def schedule_dict(a: AgentSchedule) -> dict:
    return {"number": a.number, "key": f"AG-{a.number}", "name": a.name, "task": a.task, "task_label": TASKS[a.task],
            "instruction": a.instruction, "stages": a.stages or [], "params": a.params or {}, "cron": a.cron,
            "cron_label": cron.describe(a.cron), "timezone": a.timezone, "enabled": a.enabled,
            "next_run_at": _iso(a.next_run_at), "last_run_at": _iso(a.last_run_at), "last_job_id": a.last_job_id,
            "runs": a.runs, "created_by": a.created_by, "created_at": _iso(a.created_at)}


def finding_dict(f: AgentFinding, number: int | None = None) -> dict:
    st = STAGE_BY_ID.get(f.stage_id or "")
    return {"id": f.id, "agent": f"AG-{number}" if number else None, "stage": f.stage_id,
            "stage_label": f"{st.no}{st.name}" if st else None, "severity": f.severity, "title": f.title,
            "body": f.body, "proposals": f.proposals or [], "status": f.status, "thread": f.thread or [],
            "decided_by": f.decided_by, "job_id": f.job_id, "created_at": _iso(f.created_at),
            "updated_at": _iso(f.updated_at)}


# ---------------- 予定 ----------------
def _check(task: str, cron_expr: str, tz: str, stages: list[str], params: dict, instruction: str) -> None:
    if task not in TASKS:
        raise AgentError(422, f"仕事の種類は {list(TASKS)} のどれかです")
    try:
        cron.next_after(cron_expr, _now(), tz)
    except (cron.CronError, KeyError, ValueError) as e:
        raise AgentError(422, f"cron が読めません：{e}") from None
    bad = [s for s in stages if s not in STAGE_BY_ID]
    if bad:
        raise AgentError(422, f"不明な工程：{', '.join(bad)}")
    if task == "research" and not str(params.get("library", "")).isdigit():
        raise AgentError(422, "更新するリサーチライブラリ（RL-n の n）を選んでください")
    if task == "report" and not str(params.get("report", "")).isdigit():
        raise AgentError(422, "作り直す報告資料（RP-n の n）を選んでください")
    if task == "custom" and not instruction.strip():
        raise AgentError(422, "エージェントへの指示を書いてください")


def _get(s, product_id: str, number: int) -> AgentSchedule:
    a = s.execute(select(AgentSchedule).where(AgentSchedule.product_id == product_id,
                                              AgentSchedule.number == number)).scalar_one_or_none()
    if a is None:
        raise AgentError(404, f"AG-{number} はありません")
    return a


def create(product: Product, user: str, body: dict) -> dict:
    task, expr, tz = body.get("task") or "", str(body.get("cron") or "").strip(), body.get("timezone") or "Asia/Tokyo"
    stages, params = list(body.get("stages") or []), dict(body.get("params") or {})
    instr = body.get("instruction") or ""
    _check(task, expr, tz, stages, params, instr)
    name = str(body.get("name") or "").strip() or TASKS[task]
    with session() as s:
        n = (s.execute(select(func.max(AgentSchedule.number)).where(AgentSchedule.product_id == product.id))
             .scalar() or 0) + 1
        a = AgentSchedule(tenant_id=product.tenant_id, product_id=product.id, number=n, name=name[:200], task=task,
                          instruction=instr[:4000], stages=stages, params=params, cron=expr, timezone=tz,
                          enabled=body.get("enabled") is not False, created_by=user,
                          next_run_at=cron.next_after(expr, _now(), tz))
        s.add(a)
        s.commit()
        return schedule_dict(a)


def edit(product: Product, number: int, body: dict) -> dict:
    with session() as s:
        a = _get(s, product.id, number)
        merged = {"task": a.task, "cron": a.cron, "timezone": a.timezone, "stages": a.stages or [],
                  "params": a.params or {}, "instruction": a.instruction,
                  **{k: v for k, v in body.items() if v is not None}}
        _check(merged["task"], merged["cron"], merged["timezone"], merged["stages"], merged["params"],
               merged["instruction"])
        a.task, a.cron, a.timezone = merged["task"], merged["cron"].strip(), merged["timezone"]
        a.stages, a.params, a.instruction = merged["stages"], merged["params"], merged["instruction"][:4000]
        if body.get("name") is not None:
            a.name = str(body["name"]).strip()[:200] or TASKS[a.task]
        if body.get("enabled") is not None:
            a.enabled = bool(body["enabled"])
        a.next_run_at = cron.next_after(a.cron, _now(), a.timezone)
        s.commit()
        return schedule_dict(a)


def delete(product: Product, number: int) -> None:
    with session() as s:
        s.delete(_get(s, product.id, number))
        s.commit()


def overview(product: Product) -> dict:
    with session() as s:
        rows = s.execute(select(AgentSchedule).where(AgentSchedule.product_id == product.id)
                         .order_by(AgentSchedule.number)).scalars()
        scheds = [schedule_dict(a) for a in rows]
        open_n = s.execute(select(func.count()).where(AgentFinding.product_id == product.id,
                                                      AgentFinding.status == "open")).scalar()
    return {"schedules": scheds, "tasks": TASKS, "open": open_n}


def run_now(product: Product, user: str, number: int) -> dict:
    with session() as s:
        a = _get(s, product.id, number)
        a.last_run_at, a.runs = _now(), a.runs + 1
        s.commit()
        info = schedule_dict(a)
    job_id = _dispatch(product, info, user)
    with session() as s:
        _get(s, product.id, number).last_job_id = job_id
        s.commit()
    return {**info, "last_job_id": job_id}


def _dispatch(product: Product, a: dict, user: str) -> str | None:
    """予定の仕事を始める。返り値はジョブの id。"""
    p = a["params"]
    if a["task"] == "research":
        return research.start_update(product.tenant_id, user, int(p["library"]), p.get("scope") or "all")["id"]
    if a["task"] == "report":
        return reports.regenerate(product, user, int(p["report"]))["job_id"]
    conn = llmconf.resolve(product.tenant_id)
    job_id = jobs.create("agent", product.tenant_id, product.id, user, {"agent": a["number"], "name": a["name"]},
                         total=3, model=conn.chat_model,
                         tasks=[{"id": "read", "name": "工程を読む", "deps": []},
                                {"id": "think", "name": "見直す・提案を考える", "deps": ["read"]},
                                {"id": "post", "name": "受け箱に出す", "deps": ["think"]}])
    jobs.dispatch(job_id)
    return job_id


def tick(now: dt.datetime | None = None) -> list[str]:
    """時刻が来た予定を動かす。二重に動かさないよう、次の時刻を書き換えられた予定だけを動かす。"""
    now = now or _now()
    with session() as s:
        due = s.execute(select(AgentSchedule.id, AgentSchedule.next_run_at).where(
            AgentSchedule.enabled.is_(True), AgentSchedule.next_run_at.is_not(None),
            AgentSchedule.next_run_at <= now)).all()
    started = []
    for sid, at in due:
        with session() as s:
            a = s.get(AgentSchedule, sid)
            try:
                nxt = cron.next_after(a.cron, now, a.timezone)
            except cron.CronError:
                nxt = None
            claimed = s.execute(update(AgentSchedule).where(AgentSchedule.id == sid, AgentSchedule.next_run_at == at)
                                .values(next_run_at=nxt, last_run_at=now, runs=AgentSchedule.runs + 1)).rowcount
            s.commit()
            if claimed != 1:
                continue
            a = s.get(AgentSchedule, sid)
            info = schedule_dict(a)
            product = s.get(Product, a.product_id)
            s.expunge(product)
        try:
            job_id = _dispatch(product, info, info["created_by"])
        except Exception as e:  # noqa: BLE001  1つの失敗で他の予定を止めない
            job_id = None
            _post(product, info["number"], None, [{"stage": None, "severity": "warn",
                                                   "title": f"{info['name']}を動かせませんでした",
                                                   "body": str(getattr(e, "message", e))[:500], "proposals": []}])
        with session() as s:
            s.get(AgentSchedule, sid).last_job_id = job_id
            s.commit()
        if job_id:
            started.append(job_id)
    return started


_ticker: threading.Thread | None = None


def start_ticker(every: int = 60) -> None:
    """手元・常駐の環境では、プロセスの中で1分ごとに tick する（Cloud Run では Cloud Scheduler が呼ぶ）。"""
    global _ticker
    if _ticker is not None:
        return

    def loop() -> None:
        while True:
            time.sleep(every)
            try:
                tick()
            except Exception:  # noqa: BLE001, S110  次の回で拾う
                pass

    _ticker = threading.Thread(target=loop, daemon=True, name="pf-scheduler")
    _ticker.start()


def ticker_enabled() -> bool:
    return os.environ.get("PF_SCHEDULER", "") == "thread"


# ---------------- 実行（review / custom） ----------------
def _material(product: Product, stages: list[str]) -> tuple[str, list[str]]:
    """選んだ工程（なければ使っている全工程）の下書き・最新版と、その上流の最新版。"""
    rs = repo.runs(product.id)
    ids = [s for s in (stages or list(STAGE_BY_ID)) if rs.get(s) is None or rs[s].enabled]
    parts = []
    for sid in ids:
        st, fw = STAGE_BY_ID[sid], fx.FRAMEWORK_BY_STAGE[sid]
        d = repo.draft(product.id, sid)
        miss = fx.check(fw, d)
        head = f"# 工程 {sid}（{st.no}{st.name}）の今の下書き\n"
        if miss:
            head += "（必須が空：" + "、".join(miss) + "）\n"
        parts.append(head + fx.to_markdown(st, fw, d)[:20000])
        ups = repo.confirmed_artifacts(product.id, st.inputs)
        if ups:
            body = "\n\n".join(f"### {k}\n{v[:8000]}" for k, v in ups.items())
            parts.append(f"## {st.no}{st.name}の上流の最新版\n{body}")
    return "\n\n".join(parts), ids


def _stub_findings(product: Product, ids: list[str], a: dict) -> list[dict]:
    out = []
    for sid in ids:
        fw = fx.FRAMEWORK_BY_STAGE[sid]
        d = repo.draft(product.id, sid)
        empty = [f for f in fw.fields if f.required and not fx.is_filled(f, d.get(f.key))]
        if empty:
            f = empty[0]
            out.append({"stage": sid, "severity": "action",
                        "title": f"{STAGE_BY_ID[sid].name}の「{f.label}」が空です",
                        "body": f"必須の項目が {len(empty)} 個空いています（スタブ）。",
                        "proposals": [{"field": f.key, "value": llm._stub_value(f, product.idea),
                                       "reason": "空欄の仮置き（スタブ）"}]})
    if a["task"] == "custom":
        out.append({"stage": ids[0] if ids else None, "severity": "info",
                    "title": f"指示「{a['instruction'][:40]}」への所見",
                    "body": "（スタブ）指示に沿って読みました。", "proposals": []})
    return out or [{"stage": None, "severity": "info", "title": "大きな問題は見つかりませんでした",
                    "body": "（スタブ）", "proposals": []}]


def _think(conn, product: Product, a: dict, material: str, ids: list[str]) -> list[dict]:
    goal = (f"指示：{a['instruction']}" if a["task"] == "custom" else
            "上流の最新版との食い違い、必須の抜け、根拠のない数値、工程の間で ID がつながっていない箇所、"
            "古くなった前提を探す。" + (f"\n追加の観点：{a['instruction']}" if a["instruction"] else ""))
    allowed = {sid: [f.key for f in fx.FRAMEWORK_BY_STAGE[sid].fields] for sid in ids}
    prompt = (
        f"あなたはプロダクト「{product.name}」を定期的に見直す自律エージェント「{a['name']}」です。\n{goal}\n\n"
        "## 出し方\n"
        "- findings は重要なものから最大8件。見つからなければ空でよい。言い換えや好みの問題は出さない。\n"
        "- stage は工程の id。severity は action（直すべき）・warn（確認すべき）・info（参考）。\n"
        "- title は何がどうなっているかを1文で。body に根拠（どの工程のどの記述か）と、なぜ問題かを書く。\n"
        "- 項目の値をこう直すとよい、と具体的に言えるときだけ proposals に入れる（field は項目の key、"
        "value は項目の形。table などは JSON）。資料にない数値を作らない。\n"
        f"- 使える項目：{json.dumps(allowed, ensure_ascii=False)}\n\n"
        f"## 工程\n{material[:150000]}\n"
    )
    out = llm._json(conn, conn.chat_model, prompt, FindingsOut)
    return [f.model_dump() for f in out.findings[:8]]


def _coerce_props(sid: str | None, props: list[dict]) -> list[dict]:
    if not sid or sid not in STAGE_BY_ID:
        return []
    fw = fx.FRAMEWORK_BY_STAGE[sid]
    out = []
    for p in props:
        f = fw.get(p.get("field", ""))
        if f is None:
            continue
        try:
            v = fx.coerce(f, p.get("value"))
        except (ValueError, TypeError):
            continue
        out.append({"field": f.key, "label": f.label, "value": v, "reason": p.get("reason", "")})
    return out


def _post(product: Product, number: int | None, job_id: str | None, found: list[dict]) -> int:
    with session() as s:
        sched = None
        if number is not None:
            sched = s.execute(select(AgentSchedule).where(AgentSchedule.product_id == product.id,
                                                          AgentSchedule.number == number)).scalar_one_or_none()
        n = 0
        for f in found:
            sid = f.get("stage") if f.get("stage") in STAGE_BY_ID else None
            s.add(AgentFinding(tenant_id=product.tenant_id, product_id=product.id,
                               schedule_id=sched.id if sched else None, job_id=job_id, stage_id=sid,
                               severity=f.get("severity") if f.get("severity") in SEVERITY else "info",
                               title=str(f.get("title", ""))[:300] or "所見", body=str(f.get("body", "")),
                               proposals=_coerce_props(sid, f.get("proposals") or []), thread=[]))
            n += 1
        if sched is not None and n:
            s.add(Notice(tenant_id=product.tenant_id, user=sched.created_by, product_id=product.id, kind="agent",
                         text=f"AG-{sched.number}「{sched.name}」から {n} 件の提案があります"[:300],
                         link=f"/p/{product.id}/agents", actor=f"AG-{sched.number}"))
        s.commit()
    return n


def run(job_id: str) -> None:
    with session() as s:
        j = s.get(JobRun, job_id)
        product = s.get(Product, j.product_id)
        s.expunge(product)
        info = schedule_dict(_get(s, product.id, j.params["agent"]))
    conn = llmconf.resolve(product.tenant_id)
    with jobs.task(job_id, "read"):
        material, ids = _material(product, info["stages"])
        jobs.set_task(job_id, "read", detail=f"{len(ids)}工程・{len(material)}文字")
    with jobs.task(job_id, "think"):
        if conn.provider == "stub":
            llm._record("stub", 0, 0)
            found = _stub_findings(product, ids, info)
        else:
            found = _think(conn, product, info, material, ids)
        jobs.set_task(job_id, "think", detail=f"{len(found)}件")
    with jobs.task(job_id, "post"):
        n = _post(product, info["number"], job_id, found)
        jobs.set_task(job_id, "post", detail=f"{n}件を受け箱に出した")


jobs.HANDLERS["agent"] = run


# ---------------- 受け箱（提案とのやり取り） ----------------
def findings(product: Product, status: str | None = None) -> list[dict]:
    with session() as s:
        q = select(AgentFinding, AgentSchedule.number).outerjoin(
            AgentSchedule, AgentSchedule.id == AgentFinding.schedule_id).where(AgentFinding.product_id == product.id)
        if status:
            q = q.where(AgentFinding.status == status)
        rows = s.execute(q.order_by(AgentFinding.id.desc()).limit(200)).all()
        return [finding_dict(f, n) for f, n in rows]


def _finding(s, product: Product, fid: int) -> AgentFinding:
    f = s.get(AgentFinding, fid)
    if f is None or f.product_id != product.id:
        raise AgentError(404, "提案が見つかりません")
    return f


def _say(f: AgentFinding, role: str, actor: str, text: str) -> None:
    f.thread = [*(f.thread or []), {"role": role, "actor": actor, "text": text, "at": _now().isoformat()}]


def decide(product: Product, user: str, fid: int, action: str, picks: list[int] | None = None,
           reason: str = "") -> dict:
    """accept：案を項目に入れる（picks で選べる）／reject：却下／note：確認済みにする。"""
    if action not in ("accept", "reject", "note"):
        raise AgentError(422, "action は accept・reject・note のどれかです")
    with session() as s:
        f = _finding(s, product, fid)
        if f.status != "open":
            raise AgentError(409, "この提案は処理済みです")
        props, sid = list(f.proposals or []), f.stage_id
    applied = []
    if action == "accept":
        chosen = [p for i, p in enumerate(props) if picks is None or i in picks]
        if not chosen:
            raise AgentError(422, "入れる案がありません（確認済みにする場合は note）")
        for p in chosen:
            repo.set_field(product.id, sid, p["field"], p["value"], user, "agent")
            applied.append(p["label"])
    with session() as s:
        f = _finding(s, product, fid)
        f.status = {"accept": "accepted", "reject": "rejected", "note": "noted"}[action]
        f.decided_by = user
        text = {"accept": f"採用して入れました：{'、'.join(applied)}",
                "reject": f"却下しました{f'：{reason}' if reason else ''}", "note": "確認しました"}[action]
        _say(f, "user", user, text)
        s.commit()
        return finding_dict(f)


def reply(product: Product, user: str, fid: int, text: str) -> dict:
    """返信すると AI が答える。案を直すべきなら直した案に差し替える。"""
    text = text.strip()
    if not text:
        raise AgentError(422, "返信が空です")
    with session() as s:
        f = _finding(s, product, fid)
        if f.status != "open":
            raise AgentError(409, "処理済みの提案には返信できません")
        _say(f, "user", user, text[:4000])
        s.commit()
        info = finding_dict(f)
    conn = llmconf.resolve(product.tenant_id)
    sid = info["stage"]
    if conn.provider == "stub":
        llm._record("stub", 0, 0)
        out = ReplyOut(reply=f"（スタブ）「{text[:60]}」を受けて見直しました。", revise=False, proposals=[])
    else:
        fw = fx.FRAMEWORK_BY_STAGE.get(sid) if sid else None
        draft = repo.draft(product.id, sid) if sid else {}
        about = {k: info[k] for k in ("stage_label", "title", "body", "proposals")}
        talk = "\n".join(f"{m['role']}: {m['text']}" for m in info["thread"])
        now = json.dumps({f.key: draft.get(f.key) for f in fw.fields}, ensure_ascii=False)[:40000] if fw else ""
        prompt = (
            f"あなたはプロダクト「{product.name}」を見直す自律エージェントです。出した提案に人から返信が来ました。\n"
            "- 日本語で短く直接答える。返信が正しければ認め、根拠が弱ければその理由を言う。\n"
            "- 返信を受けて案を変えるべきなら revise を true にし、直した proposals をすべて入れる"
            "（field は項目の key）。変えないなら revise は false、proposals は空。\n"
            + (llm.value_rules(fw) + "\n" if fw else "")
            + f"## 提案\n{json.dumps(about, ensure_ascii=False)}\n\n## やり取り\n{talk}\n\n"
            + (f"## 工程の今の値\n{now}\n" if fw else "")
        )
        out = llm._json(conn, conn.chat_model, prompt, ReplyOut)
    with session() as s:
        f = _finding(s, product, fid)
        if out.revise:
            new = _coerce_props(sid, [p.model_dump() for p in out.proposals])
            if new:
                f.proposals = new
        _say(f, "agent", f"agent ({conn.chat_model})", out.reply)
        s.commit()
        return finding_dict(f)
