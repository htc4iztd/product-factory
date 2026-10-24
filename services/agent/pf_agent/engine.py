"""工程管理（設計書 5.1 の「工程管理」層）。

フェーズの順序・審査・前提条件は、この決定的なコードが持つ。各ステージの中は
ADK の Workflow（workflow.py）が動き、1ステージの実行ごとに1セッションを使う（6章）。
"""
from __future__ import annotations

from google.adk.runners import Runner
from google.adk.sessions import DatabaseSessionService
from google.genai import types
from sqlalchemy import select

from . import repo
from .db import PhaseReview, Product, StageRun, async_session_db_url, init_db, pool_kwargs, session
from .stages import (
    ACCEPT_AS_IS,
    COMPLETED,
    DECISIONS,
    NEEDS_RECHECK,
    NOT_STARTED,
    PHASE_BY_ID,
    REQUEST_CHANGES,
    REVISING,
    SKIPPED,
    STAGE_BY_ID,
    STAGES,
)
from .workflow import build_stage_workflow

APP = "product-factory"
STARTABLE = (NOT_STARTED, REVISING, NEEDS_RECHECK, COMPLETED)


class FactoryError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


class Engine:
    def __init__(self, db_url: str | None = None):
        init_db(db_url)
        self.sessions = DatabaseSessionService(db_url=async_session_db_url(db_url), **pool_kwargs())
        self.workflow = build_stage_workflow()

    def _runner(self) -> Runner:
        # 呼ぶたびに作り直す：停止中の状態はDBにだけあることを前提にする
        return Runner(app_name=APP, agent=self.workflow, session_service=self.sessions)

    # ---------------- products ----------------
    def create_product(self, tenant: str, user: str, name: str, idea: str,
                       scope: str = "mvp", mode: str = "personal") -> Product:
        with session() as s:
            p = Product(tenant_id=tenant, name=name, idea=idea, scope=scope, mode=mode, created_by=user)
            s.add(p)
            s.flush()
            for st in STAGES:
                status = SKIPPED if (scope == "poc" and st.skip_in_poc) else NOT_STARTED
                s.add(StageRun(product_id=p.id, stage_id=st.id, status=status))
            s.commit()
        repo.log(p.id, None, "human", user, "product.create",
                 body={"name": name, "idea": idea, "scope": scope, "mode": mode})
        return p

    @staticmethod
    def product(product_id: str) -> Product | None:
        with session() as s:
            return s.get(Product, product_id)

    @staticmethod
    def products(tenant: str) -> list[Product]:
        with session() as s:
            return list(s.execute(select(Product).where(Product.tenant_id == tenant)
                                  .order_by(Product.created_at.desc())).scalars())

    # ---------------- stages ----------------
    def _check_startable(self, product: Product, stage_id: str) -> None:
        if product.status != "active":
            raise FactoryError(409, "このプロダクトは中止されています")
        stage = STAGE_BY_ID.get(stage_id)
        if stage is None:
            raise FactoryError(404, "unknown stage")
        phases = {p["id"]: p for p in repo.phase_states(product.id)}
        if not phases[stage.phase]["unlocked"]:
            raise FactoryError(409, f"{stage.phase} はまだ開いていません（前フェーズの審査待ち）")
        for dep in stage.inputs:
            if repo.get_run(product.id, dep).status not in (COMPLETED, SKIPPED):
                raise FactoryError(409, f"上流 {STAGE_BY_ID[dep].no}{STAGE_BY_ID[dep].name} が完了していません")
        run = repo.get_run(product.id, stage_id)
        if run.pending:
            raise FactoryError(409, "このステージは入力待ちです")
        if run.status not in STARTABLE:
            raise FactoryError(409, f"状態 {run.status} からは開始できません")

    async def start_stage(self, product: Product, stage_id: str, user: str) -> dict | None:
        self._check_startable(product, stage_id)
        with session() as s:
            r = s.execute(select(StageRun).where(StageRun.product_id == product.id,
                                                 StageRun.stage_id == stage_id)).scalar_one()
            r.audit_retries = 0
            r.audit_findings = None
            s.commit()
        sess = await self.sessions.create_session(
            app_name=APP, user_id=user,
            state={"pf_product_id": product.id, "pf_stage_id": stage_id})
        repo.set_pending(product.id, stage_id, None, session_id=sess.id)
        repo.log(product.id, stage_id, "human", user, "stage.start", body={"session_id": sess.id})
        msg = types.Content(role="user", parts=[types.Part(text="start")])
        return await self._run(product.id, stage_id, user, sess.id, msg, None)

    async def respond(self, product: Product, stage_id: str, user: str, body: dict) -> dict | None:
        run = repo.get_run(product.id, stage_id)
        pend = run.pending
        if not pend:
            raise FactoryError(409, "入力待ちではありません")
        kind = pend["kind"]
        if kind == "clarify":
            value = {"answer": str(body.get("answer", ""))}
            repo.log(product.id, stage_id, "human", user, "clarify.answer",
                     body={"questions": pend.get("payload", {}).get("questions"), "answer": value["answer"]})
        elif kind == "approval":
            decision = body.get("decision")
            if decision not in DECISIONS:
                raise FactoryError(422, f"decision は {DECISIONS} のどれか")
            comment = str(body.get("comment", ""))
            if decision in (REQUEST_CHANGES, ACCEPT_AS_IS) and not comment.strip():
                raise FactoryError(422, "Request Changes と Accept as-is には理由が必須です")
            value = {"decision": decision, "comment": comment}
            repo.log(product.id, stage_id, "human", user, "approval",
                     body=value, version=pend.get("payload", {}).get("version"),
                     reason=comment or None)
        else:
            raise FactoryError(500, f"unknown pending kind {kind}")
        msg = types.Content(role="user", parts=[types.Part(function_response=types.FunctionResponse(
            id=pend["id"], name=pend["name"], response={"result": value}))])
        repo.set_pending(product.id, stage_id, None)
        return await self._run(product.id, stage_id, user, run.session_id, msg, pend["invocation_id"])

    async def _run(self, product_id, stage_id, user, session_id, msg, invocation_id) -> dict | None:
        pending = None
        async for ev in self._runner().run_async(user_id=user, session_id=session_id,
                                                  new_message=msg, invocation_id=invocation_id):
            for fc in ev.get_function_calls() or []:
                if ev.long_running_tool_ids and fc.id in ev.long_running_tool_ids:
                    args = fc.args or {}
                    payload = args.get("payload") or {}
                    pending = {"id": fc.id, "name": fc.name, "invocation_id": ev.invocation_id,
                               "kind": payload.get("kind"), "message": args.get("message"),
                               "payload": payload}
        repo.set_pending(product_id, stage_id, pending)
        if pending:
            repo.log(product_id, stage_id, "agent", f"stage-agent:{stage_id}",
                     f"request.{pending['kind']}", body={"message": pending["message"],
                                                        "payload": pending["payload"]})
        return pending

    # ---------------- phase review (G1〜G4) ----------------
    def review_phase(self, product: Product, phase_id: str, user: str, decision: str,
                     reason: str, back_stage: str | None = None) -> None:
        ph = PHASE_BY_ID.get(phase_id)
        if ph is None or ph.gate is None:
            raise FactoryError(404, "審査のないフェーズです")
        state = {p["id"]: p for p in repo.phase_states(product.id)}[phase_id]
        if not state["unlocked"] or not state["complete"]:
            raise FactoryError(409, "フェーズ内のステージがすべて完了していません")
        if decision not in ("proceed", "back", "stop"):
            raise FactoryError(422, "decision は proceed / back / stop")
        if decision != "proceed" and not reason.strip():
            raise FactoryError(422, "戻る・やめるには理由が必須です")
        with session() as s:
            s.add(PhaseReview(product_id=product.id, phase_id=phase_id, decision=decision,
                              reason=reason, actor=user))
            if decision == "back":
                target = back_stage or ph.stages[0]
                if target not in ph.stages:
                    raise FactoryError(422, "戻り先はこのフェーズのステージ")
                r = s.execute(select(StageRun).where(StageRun.product_id == product.id,
                                                     StageRun.stage_id == target)).scalar_one()
                r.status = REVISING
            if decision == "stop":
                s.get(Product, product.id).status = "stopped"
            s.commit()
        repo.log(product.id, None, "human", user, f"phase.review.{ph.gate}",
                 body={"phase": phase_id, "decision": decision, "back_stage": back_stage},
                 reason=reason or None)

    # ---------------- views ----------------
    def overview(self, product: Product) -> dict:
        with session() as s:
            runs = {r.stage_id: r for r in s.execute(
                select(StageRun).where(StageRun.product_id == product.id)).scalars()}
        stages = []
        for st in STAGES:
            r = runs[st.id]
            stages.append({"id": st.id, "no": st.no, "name": st.name, "phase": st.phase,
                           "status": r.status, "pending_kind": (r.pending or {}).get("kind"),
                           "current_version": r.current_version,
                           "approved_version": r.approved_version})
        return {"product": product_dict(product), "phases": repo.phase_states(product.id),
                "stages": stages}

    def stage_detail(self, product: Product, stage_id: str) -> dict:
        st = STAGE_BY_ID.get(stage_id)
        if st is None:
            raise FactoryError(404, "unknown stage")
        r = repo.get_run(product.id, stage_id)
        art = repo.current_artifact(product.id, stage_id)
        return {"id": st.id, "no": st.no, "name": st.name, "phase": st.phase,
                "artifact_name": st.artifact, "required_sections": list(st.sections),
                "inputs": list(st.inputs), "status": r.status, "pending": r.pending,
                "answers": r.answers, "audit_findings": r.audit_findings,
                "current_version": r.current_version, "approved_version": r.approved_version,
                "artifact": None if art is None else {"version": art.version, "content": art.content,
                                                      "sha256": art.sha256, "approved": art.approved}}


def product_dict(p: Product) -> dict:
    return {"id": p.id, "name": p.name, "idea": p.idea, "scope": p.scope, "mode": p.mode,
            "status": p.status, "created_by": p.created_by, "created_at": p.created_at.isoformat()}
