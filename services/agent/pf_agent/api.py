"""agent-api（FastAPI）。web からだけ呼ばれる内部API。"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import select

from . import llm, llmconf
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
    session_id: str | None = None


class SessionBody(BaseModel):
    title: str = Field(default="", max_length=200)


class FieldValue(BaseModel):
    field: str
    value: str | list | None = None


class MarkdownBody(BaseModel):
    markdown: str = Field(max_length=200_000)


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


class ImageRequest(BaseModel):
    kind: str = Field(pattern="^(scene|ui|concept)$")
    note: str = Field(default="", max_length=2000)


class Cover(BaseModel):
    image_id: str | None = None


class RepoBody(BaseModel):
    repo: str = Field(default="", max_length=300)
    branch: str | None = Field(default=None, max_length=100)


class LlmBody(BaseModel):
    provider: str = Field(max_length=16)
    chat_model: str = Field(default="", max_length=120)
    summary_model: str = Field(default="", max_length=120)
    image_model: str = Field(default="", max_length=120)
    base_url: str | None = Field(default=None, max_length=500)
    project: str | None = Field(default=None, max_length=100)
    location: str | None = Field(default=None, max_length=50)
    api_key: str | None = Field(default=None, max_length=500)
    clear_key: bool = False
    allow_tenant_vertex: bool = False


class LlmTest(BaseModel):
    scope: str = Field(default="tenant", pattern="^(tenant|app)$")


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
    c = llmconf.app_conn()
    return {"ok": True, "llm": c.provider, "model": c.chat_model}


# ---------------- LLM の接続設定 ----------------
def _llm_error(e: llmconf.ConfigError):
    raise HTTPException(e.status, e.message)


@app.get("/settings/llm")
def get_llm(c: Caller = Depends(caller)):
    admin = llmconf.is_admin(c.user)
    return {
        "can_edit": c.base_role == "OWNER", "is_admin": admin, "admin_configured": llmconf.admin_configured(),
        # プラットフォーム管理者は自分のテナントでも Vertex AI を選べる。既に許された設定は持ち主が変えられる
        "allow_tenant_vertex": admin or llmconf.allow_tenant_vertex() or bool(
            (t := llmconf.view(f"t:{c.tenant}")) and t["platform_granted"] and t["provider"] == "vertex"),
        "tenant": llmconf.view(f"t:{c.tenant}"),
        "app": llmconf.view("app") if admin else None,
        "effective": llmconf.describe(llmconf.resolve(c.tenant)),
        "app_effective": llmconf.describe(llmconf.app_conn()),
        "options": llmconf.options(),
    }


@app.put("/settings/llm/tenant")
def put_llm_tenant(body: LlmBody, c: Caller = Depends(caller)):
    if c.base_role != "OWNER":
        raise HTTPException(403, "LLM の接続はテナントの OWNER だけが変えられます")
    try:
        llmconf.save(f"t:{c.tenant}", c.tenant, c.user, body.model_dump(), by_admin=llmconf.is_admin(c.user))
    except llmconf.ConfigError as e:
        _llm_error(e)
    return {"ok": True}


@app.put("/settings/llm/app")
def put_llm_app(body: LlmBody, c: Caller = Depends(caller)):
    if not llmconf.is_admin(c.user):
        raise HTTPException(403, "アプリ全体の既定はプラットフォーム管理者だけが変えられます")
    try:
        llmconf.save("app", c.tenant, c.user, body.model_dump())
    except llmconf.ConfigError as e:
        _llm_error(e)
    return {"ok": True}


@app.post("/settings/llm/test")
def test_llm(body: LlmTest, c: Caller = Depends(caller)):
    if body.scope == "app":
        if not llmconf.is_admin(c.user):
            raise HTTPException(403, "アプリ全体の既定はプラットフォーム管理者だけが試せます")
        conn = llmconf.app_conn()
    else:
        if c.base_role != "OWNER":
            raise HTTPException(403, "接続テストはテナントの OWNER だけができます")
        conn = llmconf.resolve(c.tenant)
    try:
        return llm.ping(conn)
    except Exception as e:  # noqa: BLE001  失敗の中身をそのまま画面に返す
        msg = str(e) if isinstance(e, llm.LLMError) else f"{type(e).__name__}: {str(e)[:300]}"
        return {"ok": False, "model": conn.chat_model, "error": msg}


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
def stage_detail(product_id: str, stage_id: str, session: str | None = None, c: Caller = Depends(caller)):
    p = _product(c, product_id, STAGE_GROUP.get(stage_id, "business"), "view")
    return engine.stage_detail(p, stage_id, session)


def _stage_product(c: Caller, product_id: str, stage_id: str, op: str):
    return _product(c, product_id, STAGE_GROUP.get(stage_id, "business"), op)


@app.post("/products/{product_id}/stages/{stage_id}/chat")
async def chat(product_id: str, stage_id: str, body: Chat, c: Caller = Depends(caller)):
    p = _stage_product(c, product_id, stage_id, "create")
    session_id = await engine.chat(p, stage_id, c.user, body.message, body.session_id)
    return engine.stage_detail(p, stage_id, session_id)


@app.post("/products/{product_id}/stages/{stage_id}/sessions")
def new_session(product_id: str, stage_id: str, body: SessionBody, c: Caller = Depends(caller)):
    p = _stage_product(c, product_id, stage_id, "create")
    session_id = engine.new_session(p, stage_id, c.user, body.title)
    return engine.stage_detail(p, stage_id, session_id)


@app.put("/products/{product_id}/stages/{stage_id}/sessions/{session_id}")
def rename_session(product_id: str, stage_id: str, session_id: str, body: SessionBody, c: Caller = Depends(caller)):
    p = _stage_product(c, product_id, stage_id, "create")
    engine.rename_session(p, stage_id, c.user, session_id, body.title)
    return engine.stage_detail(p, stage_id, session_id)


@app.post("/products/{product_id}/stages/{stage_id}/report")
def make_report(product_id: str, stage_id: str, c: Caller = Depends(caller)):
    p = _stage_product(c, product_id, stage_id, "create")
    engine.make_report(p, stage_id, c.user)
    return engine.stage_detail(p, stage_id)


@app.put("/products/{product_id}/stages/{stage_id}/draft")
def set_field(product_id: str, stage_id: str, body: FieldValue, c: Caller = Depends(caller)):
    p = _stage_product(c, product_id, stage_id, "create")
    engine.set_field(p, stage_id, c.user, body.field, body.value)
    return engine.stage_detail(p, stage_id)


@app.post("/products/{product_id}/stages/s13/import-acceptance")
def import_acceptance(product_id: str, c: Caller = Depends(caller)):
    p = _stage_product(c, product_id, "s13", "create")
    added = engine.import_acceptance(p, c.user)
    return {"added": added, "stage": engine.stage_detail(p, "s13")}


@app.put("/products/{product_id}/stages/{stage_id}/markdown")
def set_markdown(product_id: str, stage_id: str, body: MarkdownBody, c: Caller = Depends(caller)):
    p = _stage_product(c, product_id, stage_id, "create")
    result = engine.set_markdown(p, stage_id, c.user, body.markdown)
    return {**result, "stage": engine.stage_detail(p, stage_id)}


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


@app.get("/products/{product_id}/canvas")
def canvas(product_id: str, c: Caller = Depends(caller)):
    return engine.canvas(_product(c, product_id, "business", "view"))


@app.post("/products/{product_id}/images")
def generate_image(product_id: str, body: ImageRequest, c: Caller = Depends(caller)):
    p = _product(c, product_id, "business", "create")
    image_id = engine.generate_image(p, c.user, body.kind, body.note)
    return {"image_id": image_id, **engine.canvas(engine.product(product_id))}


@app.get("/products/{product_id}/images/{image_id}")
def image(product_id: str, image_id: str, c: Caller = Depends(caller)):
    img = engine.image(_product(c, product_id, "business", "view"), image_id)
    return Response(content=img.data, media_type=img.mime,
                    headers={"cache-control": "private, max-age=86400", "x-content-type-options": "nosniff"})


@app.put("/products/{product_id}/cover")
def set_cover(product_id: str, body: Cover, c: Caller = Depends(caller)):
    p = _product(c, product_id, "business", "create")
    engine.set_cover(p, c.user, body.image_id)
    return engine.canvas(engine.product(product_id))


@app.delete("/products/{product_id}/images/{image_id}")
def delete_image(product_id: str, image_id: str, c: Caller = Depends(caller)):
    p = _product(c, product_id, "business", "create")
    engine.delete_image(p, c.user, image_id)
    return engine.canvas(engine.product(product_id))


@app.put("/products/{product_id}/repo")
def set_repo(product_id: str, body: RepoBody, c: Caller = Depends(caller)):
    p = _product(c, product_id, "build", "assign")
    info = engine.set_repo(p, c.user, body.repo, body.branch)
    return {"repo": info, "product": product_dict(engine.product(product_id))}


@app.get("/products/{product_id}/code/tree")
def code_tree(product_id: str, c: Caller = Depends(caller)):
    return engine.code_tree(_product(c, product_id, "build", "view"))


@app.get("/products/{product_id}/code/file")
def code_file(product_id: str, path: str, c: Caller = Depends(caller)):
    data = engine.code_file(_product(c, product_id, "build", "view"), path)
    return Response(content=data, media_type="application/octet-stream",
                    headers={"cache-control": "private, max-age=30", "x-content-type-options": "nosniff"})


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
