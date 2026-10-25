"""agent-api（FastAPI）。web からだけ呼ばれる内部API。"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from . import llm
from .authz import GATE_GROUP, STAGE_GROUP, Caller, caller, require
from .db import AuditLog, session
from .engine import Engine, FactoryError, product_dict

engine: Engine | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global engine
    engine = Engine()
    yield


app = FastAPI(title="Product Factory agent-api", lifespan=lifespan)


@app.exception_handler(FactoryError)
async def _factory_error(_, exc: FactoryError):
    return JSONResponse(status_code=exc.status, content={"detail": exc.message})


class CreateProduct(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    idea: str = ""
    scope: str = Field(default="mvp", pattern="^(mvp|poc)$")
    mode: str = Field(default="personal", pattern="^(personal|corporate)$")


class Chat(BaseModel):
    message: str = Field(min_length=1, max_length=8000)


class FieldValue(BaseModel):
    field: str
    value: str | list | None = None


class ProposalDecision(BaseModel):
    message_id: int
    proposal_id: str
    accept: bool


class Commit(BaseModel):
    note: str = ""
    force: bool = False


class Decide(BaseModel):
    decision: str
    comment: str = ""


class StageSetting(BaseModel):
    enabled: bool | None = None
    approval_required: bool | None = None


class Settings(BaseModel):
    stages: dict[str, StageSetting]


class Review(BaseModel):
    decision: str = Field(pattern="^(proceed|back|stop)$")
    reason: str = ""
    back_stage: str | None = None


def _product(c: Caller, product_id: str, group: str, op: str):
    p = engine.product(product_id)
    require(c, p, group, op)
    return p


@app.get("/healthz")
def healthz():
    return {"ok": True, "llm": llm.provider(), "model": llm.model_name()}


@app.get("/products")
def list_products(c: Caller = Depends(caller)):
    return [product_dict(p) for p in engine.products(c.tenant)]


@app.post("/products")
def create_product(body: CreateProduct, c: Caller = Depends(caller)):
    if c.base_role not in ("OWNER", "ADMIN"):
        raise HTTPException(403, "プロダクトを作れるのは ADMIN 以上")
    p = engine.create_product(c.tenant, c.user, body.name, body.idea, body.scope, body.mode)
    return product_dict(p)


@app.get("/products/{product_id}")
def overview(product_id: str, c: Caller = Depends(caller)):
    return engine.overview(_product(c, product_id, "business", "view"))


@app.get("/products/{product_id}/stages/{stage_id}")
def stage_detail(product_id: str, stage_id: str, c: Caller = Depends(caller)):
    p = _product(c, product_id, STAGE_GROUP.get(stage_id, "business"), "view")
    return engine.stage_detail(p, stage_id)


def _stage_product(c: Caller, product_id: str, stage_id: str, op: str):
    return _product(c, product_id, STAGE_GROUP.get(stage_id, "business"), op)


@app.post("/products/{product_id}/stages/{stage_id}/chat")
async def chat(product_id: str, stage_id: str, body: Chat, c: Caller = Depends(caller)):
    p = _stage_product(c, product_id, stage_id, "create")
    await engine.chat(p, stage_id, c.user, body.message)
    return engine.stage_detail(p, stage_id)


@app.put("/products/{product_id}/stages/{stage_id}/draft")
def set_field(product_id: str, stage_id: str, body: FieldValue, c: Caller = Depends(caller)):
    p = _stage_product(c, product_id, stage_id, "create")
    engine.set_field(p, stage_id, c.user, body.field, body.value)
    return engine.stage_detail(p, stage_id)


@app.post("/products/{product_id}/stages/{stage_id}/proposals")
def decide_proposal(product_id: str, stage_id: str, body: ProposalDecision, c: Caller = Depends(caller)):
    p = _stage_product(c, product_id, stage_id, "create")
    engine.decide_proposal(p, stage_id, c.user, body.message_id, body.proposal_id, body.accept)
    return engine.stage_detail(p, stage_id)


@app.post("/products/{product_id}/stages/{stage_id}/commit")
def commit(product_id: str, stage_id: str, body: Commit, c: Caller = Depends(caller)):
    p = _stage_product(c, product_id, stage_id, "create")
    engine.commit(p, stage_id, c.user, body.note, body.force)
    return engine.stage_detail(p, stage_id)


@app.post("/products/{product_id}/stages/{stage_id}/ack")
def acknowledge(product_id: str, stage_id: str, c: Caller = Depends(caller)):
    p = _stage_product(c, product_id, stage_id, "create")
    engine.acknowledge(p, stage_id, c.user)
    return engine.stage_detail(p, stage_id)


@app.post("/products/{product_id}/stages/{stage_id}/decide")
def decide(product_id: str, stage_id: str, body: Decide, c: Caller = Depends(caller)):
    p = _stage_product(c, product_id, stage_id, "approve")
    engine.decide(p, stage_id, c.user, body.decision, body.comment)
    return engine.stage_detail(p, stage_id)


@app.put("/products/{product_id}/settings")
def settings(product_id: str, body: Settings, c: Caller = Depends(caller)):
    p = _product(c, product_id, "business", "assign")
    engine.update_settings(p, c.user, {k: v.model_dump() for k, v in body.stages.items()})
    return engine.overview(engine.product(product_id))


@app.post("/products/{product_id}/phases/{phase_id}/review")
def review(product_id: str, phase_id: str, body: Review, c: Caller = Depends(caller)):
    p = _product(c, product_id, GATE_GROUP.get(phase_id, "business"), "review")
    engine.review_phase(p, phase_id, c.user, body.decision, body.reason, body.back_stage)
    return engine.overview(engine.product(product_id))


@app.get("/products/{product_id}/audit")
def audit_log(product_id: str, c: Caller = Depends(caller)):
    _product(c, product_id, "business", "view")
    with session() as s:
        rows = s.execute(select(AuditLog).where(AuditLog.product_id == product_id)
                         .order_by(AuditLog.id.desc()).limit(500)).scalars()
        return [{"id": r.id, "at": r.at.isoformat(), "stage_id": r.stage_id,
                 "actor_type": r.actor_type, "actor": r.actor, "kind": r.kind,
                 "target_version": r.target_version, "body": r.body, "reason": r.reason}
                for r in rows]
