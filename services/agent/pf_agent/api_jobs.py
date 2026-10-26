"""ジョブ（定義・走行状況・履歴・取り消し）と、自動開発・プリプロダクトの API。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from . import agents, autodev, imports, jobs, reports
from .api_collab import _p
from .authz import Caller, caller
from .stages import STAGE_BY_ID

router = APIRouter()
P = "/products/{product_id}"


class ImportBody(BaseModel):
    filename: str = Field(min_length=1, max_length=300)
    content_b64: str = Field(min_length=1, max_length=28_000_000)
    mode: str = "propose"
    stages: list[str] = Field(default_factory=list, max_length=14)


@router.post(P + "/imports")
def start_import(product_id: str, body: ImportBody, c: Caller = Depends(caller)):
    return imports.start(_p(c, product_id, True), c.user, body.filename, body.content_b64, body.mode, body.stages)


@router.get(P + "/imports")
def list_imports(product_id: str, c: Caller = Depends(caller)):
    return imports.list_docs(_p(c, product_id))


@router.get(P + "/imports/{doc_id}")
def get_import(product_id: str, doc_id: int, c: Caller = Depends(caller)):
    return imports.get(_p(c, product_id), doc_id)


class ReportBody(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    audience: str = Field(default="", max_length=300)
    purpose: str = Field(default="", max_length=4000)
    selection: list[dict] = Field(min_length=1, max_length=14)
    source: str = "latest"
    slides: int = Field(default=8, ge=3, le=30)


class ReportEdit(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    data: dict | None = None


@router.get(P + "/report-sources")
def report_sources(product_id: str, c: Caller = Depends(caller)):
    return reports.sources(_p(c, product_id))


@router.get(P + "/reports")
def list_reports(product_id: str, c: Caller = Depends(caller)):
    return reports.list_reports(_p(c, product_id))


@router.post(P + "/reports")
def create_report(product_id: str, body: ReportBody, c: Caller = Depends(caller)):
    return reports.create(_p(c, product_id, True), c.user, body.title, body.audience, body.purpose, body.selection,
                          body.source, body.slides)


@router.get(P + "/reports/{number}")
def get_report(product_id: str, number: int, c: Caller = Depends(caller)):
    return reports.get(_p(c, product_id), number)


@router.put(P + "/reports/{number}")
def edit_report(product_id: str, number: int, body: ReportEdit, c: Caller = Depends(caller)):
    return reports.update(_p(c, product_id, True), number, body.title, body.data)


@router.post(P + "/reports/{number}/regenerate")
def regenerate_report(product_id: str, number: int, c: Caller = Depends(caller)):
    return reports.regenerate(_p(c, product_id, True), c.user, number)


@router.delete(P + "/reports/{number}")
def delete_report(product_id: str, number: int, c: Caller = Depends(caller)):
    reports.delete(_p(c, product_id, True), number)
    return {"ok": True}


class AgentBody(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    task: str | None = None
    instruction: str | None = Field(default=None, max_length=4000)
    stages: list[str] | None = Field(default=None, max_length=14)
    params: dict | None = None
    cron: str | None = Field(default=None, max_length=100)
    timezone: str | None = Field(default=None, max_length=40)
    enabled: bool | None = None


class DecideBody(BaseModel):
    action: str
    picks: list[int] | None = None
    reason: str = Field(default="", max_length=1000)


class ReplyBody(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


@router.get(P + "/agents")
def agents_overview(product_id: str, c: Caller = Depends(caller)):
    return agents.overview(_p(c, product_id))


@router.post(P + "/agents")
def create_agent(product_id: str, body: AgentBody, c: Caller = Depends(caller)):
    return agents.create(_p(c, product_id, True), c.user, body.model_dump())


@router.put(P + "/agents/{number}")
def edit_agent(product_id: str, number: int, body: AgentBody, c: Caller = Depends(caller)):
    return agents.edit(_p(c, product_id, True), number, body.model_dump())


@router.delete(P + "/agents/{number}")
def delete_agent(product_id: str, number: int, c: Caller = Depends(caller)):
    agents.delete(_p(c, product_id, True), number)
    return {"ok": True}


@router.post(P + "/agents/{number}/run")
def run_agent(product_id: str, number: int, c: Caller = Depends(caller)):
    return agents.run_now(_p(c, product_id, True), c.user, number)


@router.get(P + "/agent-findings")
def agent_findings(product_id: str, status: str | None = None, c: Caller = Depends(caller)):
    return agents.findings(_p(c, product_id), status)


@router.post(P + "/agent-findings/{fid}/decide")
def decide_finding(product_id: str, fid: int, body: DecideBody, c: Caller = Depends(caller)):
    return agents.decide(_p(c, product_id, True), c.user, fid, body.action, body.picks, body.reason)


@router.post(P + "/agent-findings/{fid}/reply")
def reply_finding(product_id: str, fid: int, body: ReplyBody, c: Caller = Depends(caller)):
    return agents.reply(_p(c, product_id, True), c.user, fid, body.text)


class AutodevBody(BaseModel):
    count: int = Field(default=3, ge=1, le=4)
    hint: str = Field(default="", max_length=500)


@router.post(P + "/stages/{stage_id}/autodev")
def start_autodev(product_id: str, stage_id: str, body: AutodevBody, c: Caller = Depends(caller)):
    return autodev.start(_p(c, product_id, True), c.user, stage_id, body.count, body.hint)


@router.get(P + "/preproducts")
def list_preproducts(product_id: str, c: Caller = Depends(caller)):
    return autodev.overview(_p(c, product_id))


@router.get(P + "/preproducts/{number}")
def get_preproduct(product_id: str, number: int, c: Caller = Depends(caller)):
    return autodev.variant(_p(c, product_id), number)


@router.get(P + "/preproducts/{number}/prototype")
def get_prototype(product_id: str, number: int, c: Caller = Depends(caller)):
    page = autodev.prototype_html(_p(c, product_id), number)
    # 生成した HTML は、別の場所（iframe の sandbox）で、通信なしで動かす
    return Response(page, media_type="text/html; charset=utf-8", headers={
        "content-security-policy": "sandbox allow-scripts allow-forms allow-modals; default-src 'none'; "
                                   "script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
                                   "img-src data:; font-src data:",
        "x-content-type-options": "nosniff", "cache-control": "private, no-store"})


@router.post(P + "/preproducts/{number}/adopt")
def adopt(product_id: str, number: int, c: Caller = Depends(caller)):
    return autodev.adopt(_p(c, product_id, True), c.user, number)


@router.get(P + "/preproducts/{number}/stages/{stage_id}")
def preproduct_stage(product_id: str, number: int, stage_id: str, c: Caller = Depends(caller)):
    _stage(stage_id)
    return autodev.variant_stage(_p(c, product_id), number, stage_id)


@router.post(P + "/preproducts/{number}/stages/{stage_id}/adopt")
def adopt_preproduct_stage(product_id: str, number: int, stage_id: str, c: Caller = Depends(caller)):
    _stage(stage_id)
    return autodev.adopt_stage(_p(c, product_id, True), c.user, number, stage_id)


def _stage(stage_id: str) -> None:
    if stage_id not in STAGE_BY_ID:
        raise HTTPException(404, "ステージがありません")


@router.post(P + "/autodev/{job_id}/retry")
def retry(product_id: str, job_id: str, c: Caller = Depends(caller)):
    return autodev.retry(_p(c, product_id, True), c.user, job_id)


# ---------------- ジョブ ----------------
@router.get("/jobs")
def list_jobs(kind: str | None = None, product: str | None = None, c: Caller = Depends(caller)):
    return {"definitions": jobs.definitions(c.tenant), "runs": jobs.history(c.tenant, kind, product)}


@router.get("/jobs/{job_id}")
def get_job(job_id: str, c: Caller = Depends(caller)):
    return jobs.get(job_id, c.tenant)


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str, c: Caller = Depends(caller)):
    if c.base_role == "VIEWER":
        raise HTTPException(403, "閲覧のみの権限では取り消せません")
    return jobs.cancel(job_id, c.tenant, c.user)
