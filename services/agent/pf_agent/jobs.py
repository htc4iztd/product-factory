"""ジョブ（長時間の処理）の定義・起動・走行状況・履歴。

Cloud Run では Cloud Run Jobs（環境変数 PF_JOB_NAME のジョブ）を、実行ごとに引数で JobRun の id を渡して起動する。
手元やテストでは同じ処理を裏のスレッドで動かす。どちらでも、進み具合・ログ・LLM の使用量は JobRun に残る。
取り消しは、次の区切り（工程の切れ目）で止まる。Cloud Run Jobs の実行も取り消す。
"""

from __future__ import annotations

import contextvars
import copy
import datetime as dt
import json
import os
import threading
import urllib.request
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass

from sqlalchemy import select

from . import llm, repo
from .db import JobRun, session

MAX_LOG = 300


@dataclass(frozen=True)
class JobDef:
    kind: str
    name: str
    description: str
    trigger: str
    timeout_min: int
    status: str = "available"  # available | planned


JOBS: dict[str, JobDef] = {
    "autodev": JobDef(
        "autodev",
        "以降の工程の自動開発",
        "上流で決めたことに従い、パターンごとに後工程（⑪運用方式設計まで）の下書きと、ブラウザで触れる試作を作る。"
        "できたものはプリプロダクト（PP-n）として残る。",
        "ステージの「以降の工程を自動開発する」",
        60,
    ),
    "research": JobDef(
        "research",
        "リサーチライブラリの更新",
        "前回の最新記事より後の記事を、AI の検索・RSS・指定ページから集め、要約・論点・企業・ファクトを抜き出す。"
        "新しい記事が3件以上入った論点のまとめを書き直す。",
        "リサーチライブラリの「更新」",
        60,
    ),
    "canvas": JobDef(
        "canvas",
        "プロダクト・キャンバスの生成",
        "プロダクトの全体像の絵を作る。対話でプロダクトを作ったときは、最初の1枚（表紙）を自動で作る。",
        "新しいプロダクトの作成・プロダクト・キャンバスの「生成する」",
        10,
    ),
    "deploy": JobDef(
        "deploy",
        "採用したプリプロダクトの展開",
        "採用したプリプロダクトを、⑧⑨⑩⑪の内容に沿って実コードにし、GitHub に置いて Cloud Run に展開する。",
        "プリプロダクトの「展開する」（第2段で追加）",
        60,
        status="planned",
    ),
}

# kind → 実行する関数（job_id を受け取る）。各モジュールが登録する
HANDLERS: dict[str, Callable[[str], None]] = {}


class Cancelled(Exception):
    pass


class JobError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def runner() -> str:
    return "cloud-run-job" if os.environ.get("PF_JOB_NAME") else "thread"


def create(
    kind: str,
    tenant_id: str,
    product_id: str | None,
    user: str,
    params: dict,
    total: int,
    model: str = "",
    retry_of: str | None = None,
    tasks: list[dict] | None = None,
) -> str:
    with session() as s:
        j = JobRun(
            kind=kind,
            tenant_id=tenant_id,
            product_id=product_id,
            params=params,
            model=model,
            progress={"done": 0, "total": total, "step": "待機中"},
            log=[],
            usage=llm.new_meter(),
            runner=runner(),
            created_by=user,
            retry_of=retry_of,
            tasks=[_new_task(t) for t in tasks or []],
        )
        s.add(j)
        s.commit()
        return j.id


def dispatch(job_id: str) -> None:
    if runner() == "cloud-run-job":
        _start_cloud_run_job(job_id)
    else:
        threading.Thread(target=execute, args=(job_id,), daemon=True).start()


def _gcp_token() -> str:
    meta = urllib.request.Request(
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
        headers={"Metadata-Flavor": "Google"},
    )
    return json.loads(urllib.request.urlopen(meta, timeout=10).read())["access_token"]


def _job_url(suffix: str = "") -> str:
    project = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
    region = os.environ.get("PF_JOB_REGION", "asia-northeast1")
    return (
        f"https://run.googleapis.com/v2/projects/{project}/locations/{region}/jobs/{os.environ['PF_JOB_NAME']}{suffix}"
    )


def _start_cloud_run_job(job_id: str) -> None:
    body = {"overrides": {"containerOverrides": [{"args": ["-m", "pf_agent.worker", job_id]}]}}
    try:
        headers = {"Authorization": f"Bearer {_gcp_token()}", "Content-Type": "application/json"}
        req = urllib.request.Request(_job_url(":run"), data=json.dumps(body).encode(), method="POST", headers=headers)
        op = json.loads(urllib.request.urlopen(req, timeout=20).read())
    except Exception as e:  # noqa: BLE001  起動できなければ失敗にして画面に出す
        finish(job_id, "failed", f"Cloud Run Jobs を起動できません：{e}")
        raise JobError(502, f"ジョブを起動できません：{e}") from None
    execution = (op.get("metadata") or {}).get("name")
    with session() as s:
        s.get(JobRun, job_id).execution = execution
        s.commit()


def execute(job_id: str) -> None:
    """ジョブ本体を動かす（Cloud Run Jobs の中でも、スレッドでも同じ）。"""
    with session() as s:
        j = s.get(JobRun, job_id)
        if j is None or j.status != "queued":
            return
        if j.cancel_requested:
            j.status, j.finished_at = "cancelled", _now()
            tasks = copy.deepcopy(j.tasks or [])
            _close_tasks(tasks, "cancelled")
            j.tasks = tasks
            s.commit()
            return
        j.status, j.started_at = "running", _now()
        kind = j.kind
        s.commit()
    meter = llm.new_meter()
    ctx = contextvars.copy_context()
    try:
        ctx.run(_run_tracked, HANDLERS[kind], job_id, meter)
    except Cancelled:
        finish(job_id, "cancelled", None, meter)
    except Exception as e:  # noqa: BLE001  失敗の中身をそのまま残す
        finish(job_id, "failed", getattr(e, "message", None) or str(e)[:1000] or type(e).__name__, meter)
    else:
        with session() as s:
            j = s.get(JobRun, job_id)
            status = "done" if j.status == "running" else j.status
        finish(job_id, status, None, meter)


def _run_tracked(fn: Callable[[str], None], job_id: str, meter: dict) -> None:
    with llm.track(meter):
        _METER[job_id] = meter
        try:
            fn(job_id)
        finally:
            _METER.pop(job_id, None)


_METER: dict[str, dict] = {}
_step_lock = threading.Lock()  # 案ごとのスレッドが同時に進み具合を書き換えても、取りこぼさない


def meter(job_id: str) -> dict | None:
    return _METER.get(job_id)


def step(job_id: str, text: str, advance: bool = True) -> None:
    """進み具合を1つ進め、ログに残す。取り消されていれば Cancelled を投げる。"""
    with _step_lock, session() as s:
        j = s.get(JobRun, job_id)
        p = dict(j.progress or {})
        if advance:
            p["done"] = min(p.get("done", 0) + 1, p.get("total", 1))
        p["step"] = text
        j.progress = p
        j.log = [*(j.log or []), {"at": _now().isoformat(), "step": text}][-MAX_LOG:]
        m = _METER.get(job_id)
        if m is not None:
            j.usage = json.loads(json.dumps(m))
        cancel = j.cancel_requested
        s.commit()
    if cancel:
        raise Cancelled()


# ---------------- 工程（タスク） ----------------
# ジョブの中の工程を、依存関係つきで持つ（Airflow のタスクにあたる）。画面のグラフ・グリッド・ガントはこれを描く
TASK_STATES = ("pending", "running", "done", "failed", "skipped", "cancelled")


def _new_task(t: dict) -> dict:
    return {
        "id": t["id"],
        "name": t.get("name", t["id"]),
        "group": t.get("group", ""),
        "deps": list(t.get("deps", [])),
        "status": "pending",
        "started_at": None,
        "finished_at": None,
        "error": None,
        "detail": "",
        "usage": None,
    }


def _update_tasks(job_id: str, fn: Callable[[list[dict]], None]) -> None:
    # JSON の列は中身を書き換えても変更と見なされないので、複製して差し替える
    with _step_lock, session() as s:
        j = s.get(JobRun, job_id)
        tasks = copy.deepcopy(j.tasks or [])
        fn(tasks)
        j.tasks = tasks
        s.commit()


def define_tasks(job_id: str, tasks: list[dict]) -> None:
    """工程を足す。同じ id があれば名前とまとまり（group）だけ書き換える。"""

    def apply(cur: list[dict]) -> None:
        have = {t["id"]: t for t in cur}
        for t in tasks:
            if t["id"] in have:
                have[t["id"]].update({k: t[k] for k in ("name", "group") if k in t})
            else:
                cur.append(_new_task(t))

    _update_tasks(job_id, apply)


def set_task(job_id: str, task_id: str, **fields) -> None:
    def apply(cur: list[dict]) -> None:
        for t in cur:
            if t["id"] == task_id:
                t.update(fields)

    _update_tasks(job_id, apply)


def skip_task(job_id: str, task_id: str, detail: str = "") -> None:
    set_task(job_id, task_id, status="skipped", detail=detail, finished_at=_now().isoformat())


@contextmanager
def task(job_id: str, task_id: str) -> Iterator[None]:
    """工程を1つ実行する。開始・終了の時刻、失敗の理由、この工程で使った LLM のトークンを残す。"""
    set_task(job_id, task_id, status="running", started_at=_now().isoformat(), error=None)
    m = llm.new_meter()
    token = llm.task_meter.set(m)
    try:
        yield
    except Cancelled:
        set_task(job_id, task_id, status="cancelled", finished_at=_now().isoformat(), usage=copy.deepcopy(m))
        raise
    except Exception as e:
        err = getattr(e, "message", None) or str(e)[:500] or type(e).__name__
        set_task(job_id, task_id, status="failed", finished_at=_now().isoformat(), error=err, usage=copy.deepcopy(m))
        raise
    else:
        set_task(job_id, task_id, status="done", finished_at=_now().isoformat(), usage=copy.deepcopy(m))
    finally:
        llm.task_meter.reset(token)


def _close_tasks(tasks: list[dict], status: str) -> None:
    """ジョブが終わったとき、まだ終わっていない工程の状態を決める。"""
    now = _now().isoformat()
    for t in tasks:
        if t["status"] == "running":
            t["status"], t["finished_at"] = ("cancelled" if status == "cancelled" else "failed"), now
        elif t["status"] == "pending":
            t["status"] = "cancelled" if status == "cancelled" else "skipped"


def finish(job_id: str, status: str, error: str | None = None, usage: dict | None = None) -> None:
    with session() as s:
        j = s.get(JobRun, job_id)
        j.status, j.error, j.finished_at = status, error, _now()
        tasks = copy.deepcopy(j.tasks or [])
        _close_tasks(tasks, status)
        j.tasks = tasks
        if usage is not None:
            j.usage = json.loads(json.dumps(usage))
        j.log = [
            *(j.log or []),
            {
                "at": _now().isoformat(),
                "step": {"done": "完了", "failed": f"失敗：{error}", "cancelled": "取り消し"}.get(status, status),
            },
        ]
        s.commit()
        product_id, kind, tenant_id = j.product_id, j.kind, j.tenant_id
    repo.log(
        product_id, None, "agent", f"job:{kind}", f"job.{status}", {"job": job_id, "error": error}, tenant_id=tenant_id
    )


def cancel(job_id: str, tenant_id: str, user: str) -> dict:
    with session() as s:
        j = s.get(JobRun, job_id)
        if j is None or j.tenant_id != tenant_id:
            raise JobError(404, "ジョブがありません")
        if j.status not in ("queued", "running"):
            raise JobError(409, "動いていないジョブは取り消せません")
        j.cancel_requested = True
        if j.status == "queued" and j.runner == "thread":
            j.status, j.finished_at = "cancelled", _now()
            tasks = copy.deepcopy(j.tasks or [])
            _close_tasks(tasks, "cancelled")
            j.tasks = tasks
        execution = j.execution
        s.commit()
    if execution and runner() == "cloud-run-job":
        try:
            req = urllib.request.Request(
                f"https://run.googleapis.com/v2/{execution}:cancel",
                data=b"{}",
                method="POST",
                headers={"Authorization": f"Bearer {_gcp_token()}", "Content-Type": "application/json"},
            )
            urllib.request.urlopen(req, timeout=20).read()
            # 実行を止めるとコンテナごと終わり、ジョブの中からは終了を書けないので、ここで取り消し済みにする
            if get(job_id, tenant_id)["status"] in ("queued", "running"):
                finish(job_id, "cancelled", None)
        except Exception:  # noqa: BLE001,S110  実行が既に終わっていても、取り消しの印は残っている
            pass
    repo.log(None, None, "human", user, "job.cancel", {"job": job_id}, tenant_id=tenant_id)
    return run_dict(job_id)


def run_dict(job_id: str) -> dict:
    with session() as s:
        j = s.get(JobRun, job_id)
        return _dict(j)


def _dict(j: JobRun, full: bool = True) -> dict:
    took = None
    if j.started_at:  # SQLite はタイムゾーンなしで返すので UTC として扱う

        def aware(d):
            return d if d.tzinfo else d.replace(tzinfo=dt.UTC)

        took = int((aware(j.finished_at or _now()) - aware(j.started_at)).total_seconds())
    d = {
        "id": j.id,
        "kind": j.kind,
        "name": JOBS[j.kind].name if j.kind in JOBS else j.kind,
        "product_id": j.product_id,
        "params": j.params,
        "status": j.status,
        "progress": j.progress,
        "usage": j.usage,
        "runner": j.runner,
        "execution": j.execution,
        "error": j.error,
        "model": j.model,
        "retry_of": j.retry_of,
        "cancel_requested": j.cancel_requested,
        "created_by": j.created_by,
        "created_at": j.created_at.isoformat(),
        "started_at": j.started_at.isoformat() if j.started_at else None,
        "finished_at": j.finished_at.isoformat() if j.finished_at else None,
        "seconds": took,
        "tasks": j.tasks or [],
    }
    if full:
        d["log"] = j.log or []
    return d


def history(tenant_id: str, kind: str | None = None, product_id: str | None = None, limit: int = 100) -> list[dict]:
    with session() as s:
        q = select(JobRun).where(JobRun.tenant_id == tenant_id)
        if kind:
            q = q.where(JobRun.kind == kind)
        if product_id:
            q = q.where(JobRun.product_id == product_id)
        return [_dict(j, full=False) for j in s.execute(q.order_by(JobRun.created_at.desc()).limit(limit)).scalars()]


def get(job_id: str, tenant_id: str) -> dict:
    with session() as s:
        j = s.get(JobRun, job_id)
        if j is None or j.tenant_id != tenant_id:
            raise JobError(404, "ジョブがありません")
        return _dict(j)


def definitions(tenant_id: str) -> list[dict]:
    with session() as s:
        rows = list(s.execute(select(JobRun).where(JobRun.tenant_id == tenant_id)).scalars())
    out = []
    for d in JOBS.values():
        mine = [r for r in rows if r.kind == d.kind]
        tokens = sum(((r.usage or {}).get("input_tokens", 0) + (r.usage or {}).get("output_tokens", 0)) for r in mine)
        out.append(
            {
                "kind": d.kind,
                "name": d.name,
                "description": d.description,
                "trigger": d.trigger,
                "timeout_min": d.timeout_min,
                "status": d.status,
                "runner": runner(),
                "cloud_run_job": os.environ.get("PF_JOB_NAME"),
                "region": os.environ.get("PF_JOB_REGION"),
                "runs": len(mine),
                "running": sum(r.status in ("queued", "running") for r in mine),
                "failed": sum(r.status == "failed" for r in mine),
                "tokens": tokens,
            }
        )
    return out
