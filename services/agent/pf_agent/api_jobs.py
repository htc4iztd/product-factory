"""ジョブ（定義・走行状況・履歴・取り消し）と、自動開発・プリプロダクトの API。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from . import autodev, jobs
from .api_collab import _p
from .authz import Caller, caller
from .stages import STAGE_BY_ID

router = APIRouter()
P = "/products/{product_id}"


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
