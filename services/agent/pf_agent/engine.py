"""工程管理（設計書 5.1 の「工程管理」層）。

工程（17工程を14ステージにまとめたもの）の並びと、ステージ間の入力関係・変更の伝播は、
この決定的なコードが持つ。工程の順序でロックはしない。どのステージからでも始められ、
最新版が変わると参照している下流が「要再確認」になる。

各ステージの中では、ビルダーとAIの対話を ADK の Workflow（workflow.py）が動かし、
ステージごとに1つのセッションを使う。
"""
from __future__ import annotations

from google.adk.runners import Runner
from google.adk.sessions import DatabaseSessionService
from google.genai import types
from sqlalchemy import select

from . import frameworks as fx
from . import images, llm, repo
from .db import (
    PhaseReview,
    Product,
    ProductImage,
    StageRun,
    async_session_db_url,
    init_db,
    pool_kwargs,
    session,
)
from .stages import (
    ACCEPT_AS_IS,
    APPROVE,
    AWAITING_APPROVAL,
    COMPLETED,
    DECISIONS,
    NEEDS_RECHECK,
    NOT_STARTED,
    PHASE_BY_ID,
    REQUEST_CHANGES,
    REVISING,
    STAGE_BY_ID,
    STAGES,
)
from .workflow import build_chat_workflow

APP = "product-factory"


class FactoryError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


class Engine:
    def __init__(self, db_url: str | None = None):
        init_db(db_url)
        self.sessions = DatabaseSessionService(db_url=async_session_db_url(db_url), **pool_kwargs())
        self.workflow = build_chat_workflow()

    def _runner(self) -> Runner:
        # 呼ぶたびに作り直す：状態はDBにだけあることを前提にする
        return Runner(app_name=APP, agent=self.workflow, session_service=self.sessions)

    # ---------------- products ----------------
    def create_product(self, tenant: str, user: str, name: str, idea: str,
                       scope: str = "mvp", mode: str = "personal") -> Product:
        # 承認の既定：法人モードは全ステージ必須、個人モードは不要（あとで設定で変えられる）
        approval = mode == "corporate"
        with session() as s:
            p = Product(tenant_id=tenant, name=name, idea=idea, scope=scope, mode=mode, created_by=user)
            s.add(p)
            s.flush()
            for st in STAGES:
                s.add(StageRun(product_id=p.id, stage_id=st.id, status=NOT_STARTED,
                               enabled=not (scope == "poc" and st.skip_in_poc), approval_required=approval))
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
    @staticmethod
    def _stage(product: Product, stage_id: str, writable: bool = True):
        stage = STAGE_BY_ID.get(stage_id)
        if stage is None:
            raise FactoryError(404, "unknown stage")
        if writable and product.status != "active":
            raise FactoryError(409, "このプロダクトは中止されています")
        if writable and not repo.get_run(product.id, stage_id).enabled:
            raise FactoryError(409, "このステージは閉じています（設定で開けます）")
        return stage

    async def chat(self, product: Product, stage_id: str, user: str, message: str,
                   session_id: str | None = None) -> str:
        """発言を送り、AIの返答と案を待つ。返り値は使った対話セッションの id。"""
        self._stage(product, stage_id)
        if not message.strip():
            raise FactoryError(422, "発言が空です")
        if session_id and repo.get_session(product.id, stage_id, session_id) is None:
            raise FactoryError(404, "対話セッションが見つかりません")
        session_id = session_id or repo.current_session(product.id, stage_id, user)
        cs = repo.get_session(product.id, stage_id, session_id)
        adk_id = cs.adk_session_id
        adk = await self.sessions.get_session(app_name=APP, user_id=product.id, session_id=adk_id) if adk_id else None
        # セッションを持つ前の ADK セッションは、どの対話セッションのものか分からないので作り直す
        if adk is None or adk.state.get("pf_chat_session_id") != session_id:
            # ADK のセッションの持ち主はプロダクト（ビルダーが替わっても同じ対話を続ける）
            sess = await self.sessions.create_session(
                app_name=APP, user_id=product.id,
                state={"pf_product_id": product.id, "pf_stage_id": stage_id, "pf_chat_session_id": session_id})
            adk_id = sess.id
            repo.set_adk_session(session_id, adk_id)
        repo.add_chat(product.id, stage_id, "user", user, message.strip(), session_id=session_id)
        msg = types.Content(role="user", parts=[types.Part(text=message.strip())])
        async for _ in self._runner().run_async(user_id=product.id, session_id=adk_id, new_message=msg):
            pass
        return session_id

    def new_session(self, product: Product, stage_id: str, user: str, title: str | None) -> str:
        self._stage(product, stage_id)
        return repo.create_session(product.id, stage_id, user, title)

    def rename_session(self, product: Product, stage_id: str, user: str, session_id: str, title: str) -> None:
        self._stage(product, stage_id)
        if not title.strip():
            raise FactoryError(422, "名前が空です")
        try:
            repo.rename_session(product.id, stage_id, session_id, title, user)
        except KeyError:
            raise FactoryError(404, "対話セッションが見つかりません") from None

    def make_report(self, product: Product, stage_id: str, user: str) -> None:
        """ステージの全セッションの対話をレポートにまとめる。"""
        stage = self._stage(product, stage_id, writable=False)
        fw = fx.FRAMEWORK_BY_STAGE[stage_id]
        titles = {x["id"]: x["title"] for x in repo.sessions(product.id, stage_id)}
        messages = [dict(m, session=titles.get(m["session_id"], "")) for m in repo.chat(product.id, stage_id)]
        if not messages:
            raise FactoryError(409, "まだ対話がありません")
        label = {f.key: f.label for f in fw.fields}
        def brief(p: dict) -> str:  # noqa: E306
            v = p["value"]
            text = "／".join(map(str, v)) if isinstance(v, list) and v and not isinstance(v[0], dict) else (
                f"{len(v)}行の表" if isinstance(v, list) else str(v))
            return f"{label.get(p['field'], p['field'])}：{text[:120]}"
        props = [p for m in messages for p in m["proposals"]]
        accepted = [brief(p) for p in props if p["status"] == "accepted"]
        rejected = [brief(p) for p in props if p["status"] == "rejected"]
        try:
            content = llm.summarize(stage, fw, messages, accepted, rejected)
        except Exception as e:  # noqa: BLE001  失敗はそのまま画面に返す
            raise FactoryError(502, f"レポートを作れませんでした：{e}") from None
        repo.save_report(product.id, stage_id, content, messages[-1]["id"], llm.model_name(), user)

    def set_field(self, product: Product, stage_id: str, user: str, key: str, value) -> None:
        self._stage(product, stage_id)
        try:
            repo.set_field(product.id, stage_id, key, value, user, "edit")
        except KeyError:
            raise FactoryError(404, f"unknown field {key}") from None
        except (ValueError, TypeError) as e:
            raise FactoryError(422, f"値の形が合いません：{e}") from None

    def set_markdown(self, product: Product, stage_id: str, user: str, markdown: str) -> dict:
        """文書タブで書いた Markdown を、見出しごとに項目へ反映する。"""
        self._stage(product, stage_id)
        values, notes = fx.from_markdown(fx.FRAMEWORK_BY_STAGE[stage_id], markdown)
        changed = repo.set_fields(product.id, stage_id, values, user, "markdown")
        return {"changed": changed, "notes": notes}

    def decide_proposal(self, product: Product, stage_id: str, user: str, message_id: int,
                        proposal_id: str, accept: bool) -> None:
        self._stage(product, stage_id)
        try:
            repo.decide_proposal(product.id, stage_id, message_id, proposal_id, accept, user)
        except KeyError:
            raise FactoryError(404, "案が見つかりません") from None
        except ValueError as e:
            raise FactoryError(409, str(e)) from None

    def commit(self, product: Product, stage_id: str, user: str, note: str, force: bool) -> dict:
        stage = self._stage(product, stage_id)
        run = repo.get_run(product.id, stage_id)
        if run.status == AWAITING_APPROVAL:
            raise FactoryError(409, "承認待ちです。承認するか、修正指示を出してから更新し直してください")
        d = repo.draft(product.id, stage_id)
        fw = fx.FRAMEWORK_BY_STAGE[stage.id]
        findings = fx.check(fw, d)
        if findings and not force:
            raise FactoryError(422, "必須の項目が空です：" + "、".join(findings))
        cur = repo.current_artifact(product.id, stage_id)
        if cur is not None and cur.data == d and run.approved_version == cur.version:
            raise FactoryError(409, "最新版から変更がありません")
        return repo.commit(product.id, stage_id, user, note)

    def acknowledge(self, product: Product, stage_id: str, user: str) -> None:
        """上流が変わっても内容を変えなくてよいと判断したとき、最新版のまま「更新済み」に戻す。"""
        self._stage(product, stage_id)
        if repo.get_run(product.id, stage_id).status != NEEDS_RECHECK:
            raise FactoryError(409, "要再確認ではありません")
        repo.set_status(product.id, stage_id, COMPLETED)
        repo.log(product.id, stage_id, "human", user, "recheck.ack")

    def decide(self, product: Product, stage_id: str, user: str, decision: str, comment: str) -> None:
        self._stage(product, stage_id)
        run = repo.get_run(product.id, stage_id)
        if run.status != AWAITING_APPROVAL:
            raise FactoryError(409, "承認待ちではありません")
        if decision not in DECISIONS:
            raise FactoryError(422, f"decision は {DECISIONS} のどれか")
        if decision in (REQUEST_CHANGES, ACCEPT_AS_IS) and not comment.strip():
            raise FactoryError(422, "Request Changes と Accept as-is には理由が必須です")
        repo.log(product.id, stage_id, "human", user, "approval",
                 body={"decision": decision, "comment": comment}, version=run.current_version,
                 reason=comment or None)
        if decision in (APPROVE, ACCEPT_AS_IS):
            repo.complete_stage(product.id, stage_id, decision)
        else:
            repo.request_changes(product.id, stage_id, user, comment.strip())

    def update_settings(self, product: Product, user: str, stages: dict[str, dict]) -> None:
        for sid, cfg in stages.items():
            if sid not in STAGE_BY_ID:
                raise FactoryError(404, f"unknown stage {sid}")
            repo.update_settings(product.id, sid, user, cfg.get("enabled"), cfg.get("approval_required"))

    # ---------------- プロダクト・キャンバス ----------------
    def canvas(self, product: Product) -> dict:
        with session() as s:
            rows = s.execute(select(ProductImage.id, ProductImage.kind, ProductImage.note, ProductImage.prompt,
                                    ProductImage.model, ProductImage.created_by, ProductImage.created_at)
                             .where(ProductImage.product_id == product.id)
                             .order_by(ProductImage.created_at.desc())).all()
        return {"product": product_dict(product), "kinds": images.KINDS, "model": images.model_name(),
                "facts": images.summary(product.id),
                "images": [{"id": r.id, "kind": r.kind, "note": r.note, "prompt": r.prompt, "model": r.model,
                            "created_by": r.created_by, "created_at": r.created_at.isoformat()} for r in rows]}

    def generate_image(self, product: Product, user: str, kind: str, note: str) -> str:
        if product.status != "active":
            raise FactoryError(409, "このプロダクトは中止されています")
        if kind not in images.KINDS:
            raise FactoryError(422, f"kind は {list(images.KINDS)} のどれか")
        facts = images.summary(product.id)
        prompt = images.build_prompt(kind, product.name, product.idea, facts, note)
        try:
            data, mime = images.generate(kind, prompt, product.name, facts)
        except Exception as e:  # 生成の失敗はそのまま画面に返す
            raise FactoryError(502, f"画像を生成できませんでした：{e}") from None
        with session() as s:
            img = ProductImage(product_id=product.id, kind=kind, note=note, prompt=prompt,
                               model=images.model_name(), mime=mime, data=data, created_by=user)
            s.add(img)
            s.flush()
            p = s.get(Product, product.id)
            if not p.cover_image_id:
                p.cover_image_id = img.id   # 最初の1枚は自動で表紙にする
            s.commit()
            image_id = img.id
        repo.log(product.id, None, "agent", f"image-agent ({images.model_name()})", "image.generate",
                 body={"image_id": image_id, "kind": kind, "note": note, "prompt": prompt})
        return image_id

    @staticmethod
    def image(product: Product, image_id: str) -> ProductImage:
        with session() as s:
            img = s.get(ProductImage, image_id)
        if img is None or img.product_id != product.id:
            raise FactoryError(404, "画像が見つかりません")
        return img

    def set_cover(self, product: Product, user: str, image_id: str | None) -> None:
        if image_id:
            self.image(product, image_id)
        with session() as s:
            s.get(Product, product.id).cover_image_id = image_id
            s.commit()
        repo.log(product.id, None, "human", user, "image.cover", body={"image_id": image_id})

    def delete_image(self, product: Product, user: str, image_id: str) -> None:
        self.image(product, image_id)
        with session() as s:
            s.delete(s.get(ProductImage, image_id))
            p = s.get(Product, product.id)
            if p.cover_image_id == image_id:
                p.cover_image_id = None
            s.commit()
        repo.log(product.id, None, "human", user, "image.delete", body={"image_id": image_id})

    # ---------------- phase review (G1〜G4) ----------------
    def review_phase(self, product: Product, phase_id: str, user: str, decision: str,
                     reason: str, back_stage: str | None = None) -> None:
        """フェーズの区切りでの振り返り。進行のロックではなく、判断の記録として残す。"""
        ph = PHASE_BY_ID.get(phase_id)
        if ph is None or ph.gate is None:
            raise FactoryError(404, "審査のないフェーズです")
        if decision not in ("proceed", "back", "stop"):
            raise FactoryError(422, "decision は proceed / back / stop")
        if decision != "proceed" and not reason.strip():
            raise FactoryError(422, "戻る・やめるには理由が必須です")
        target = None
        if decision == "back":
            target = back_stage or ph.stages[0]
            if target not in ph.stages:
                raise FactoryError(422, "戻り先はこのフェーズのステージ")
        with session() as s:
            s.add(PhaseReview(product_id=product.id, phase_id=phase_id, decision=decision,
                              reason=reason, actor=user))
            if target:
                r = s.execute(select(StageRun).where(StageRun.product_id == product.id,
                                                     StageRun.stage_id == target)).scalar_one()
                r.status = REVISING
                r.pending = None
            if decision == "stop":
                s.get(Product, product.id).status = "stopped"
            s.commit()
        repo.log(product.id, None, "human", user, f"phase.review.{ph.gate}",
                 body={"phase": phase_id, "decision": decision, "back_stage": target},
                 reason=reason or None)
        if target:
            repo.add_chat(product.id, target, "feedback", user, f"{ph.gate} 審査で差し戻し：{reason}")

    # ---------------- views ----------------
    def overview(self, product: Product) -> dict:
        rs = repo.runs(product.id)
        stages = []
        for st in STAGES:
            r = rs[st.id]
            fw = fx.FRAMEWORK_BY_STAGE[st.id]
            stages.append({"id": st.id, "no": st.no, "name": st.name, "phase": st.phase,
                           "framework": fw.title, "status": r.status, "enabled": r.enabled,
                           "approval_required": r.approval_required,
                           "pending_kind": (r.pending or {}).get("kind"),
                           "current_version": r.current_version, "approved_version": r.approved_version})
        return {"product": product_dict(product), "phases": repo.phase_states(product.id), "stages": stages}

    def stage_detail(self, product: Product, stage_id: str, session_id: str | None = None) -> dict:
        st = self._stage(product, stage_id, writable=False)
        fw = fx.FRAMEWORK_BY_STAGE[stage_id]
        r = repo.get_run(product.id, stage_id)
        d = repo.draft(product.id, stage_id)
        art = repo.current_artifact(product.id, stage_id)
        rs = repo.runs(product.id)
        sessions = repo.sessions(product.id, stage_id)
        ids = [x["id"] for x in sessions]
        current = session_id if session_id in ids else (ids[0] if ids else None)
        return {
            "id": st.id, "no": st.no, "name": st.name, "phase": st.phase,
            "framework": {"view": fw.view, "title": fw.title, "summary": fw.summary,
                          "fields": fx.spec(fw), "prompts": list(fw.prompts)},
            "status": r.status, "enabled": r.enabled, "approval_required": r.approval_required,
            "pending": r.pending, "audit_findings": r.audit_findings, "missing": fx.check(fw, d),
            "current_version": r.current_version, "approved_version": r.approved_version,
            "dirty": art is None or art.data != d,
            "draft": d, "sessions": sessions, "session_id": current, "chat": repo.chat(product.id, stage_id, current),
            "report": repo.latest_report(product.id, stage_id), "versions": repo.versions(product.id, stage_id),
            "markdown": fx.to_markdown(st, fw, d),
            "inputs": [{"id": i, "no": STAGE_BY_ID[i].no, "name": STAGE_BY_ID[i].name,
                        "status": rs[i].status, "enabled": rs[i].enabled} for i in st.inputs],
            "downstream": [{"id": s.id, "no": s.no, "name": s.name} for s in STAGES if stage_id in s.inputs],
            "references": self._references(product, stage_id, rs),
            "trace": self._trace(product, stage_id, d),
        }

    @staticmethod
    def _data(product: Product, stage_id: str) -> dict:
        """他のステージの値：最新版があれば最新版、なければ下書き。"""
        art = repo.confirmed_artifact(product.id, stage_id)
        return art.data if art is not None and art.data else repo.draft(product.id, stage_id)

    def _trace(self, product: Product, stage_id: str, draft: dict) -> dict | None:
        """ID でつないだ網羅の状況（⑥ストーリー↔受入基準、⑥ストーリー↔⑧機能要求、⑥受入基準↔⑬結果）。"""
        if stage_id == "s06":
            stories = [r for r in draft.get("stories") or [] if r.get("id")]
            with_ac = {sid for r in draft.get("acceptance") or [] for sid in fx.ids_in(r.get("story"))}
            return {"kind": "stories_without_ac", "items": [
                {"id": r["id"], "text": r.get("story", ""), "release": r.get("release", "")}
                for r in stories if r["id"] not in with_ac], "total": len(stories)}
        if stage_id == "s08":
            stories = [r for r in self._data(product, "s06").get("stories") or [] if r.get("id")]
            cover: dict[str, list[str]] = {}
            for fr in draft.get("functional") or []:
                for sid in fx.ids_in(fr.get("stories")):
                    cover.setdefault(sid, []).append(fr.get("id", ""))
            return {"kind": "story_coverage", "total": len(stories), "items": [
                {"id": r["id"], "text": r.get("story", ""), "release": r.get("release", ""),
                 "by": cover.get(r["id"], [])} for r in stories]}
        if stage_id == "s13":
            acs = [r for r in self._data(product, "s06").get("acceptance") or [] if r.get("id")]
            rows = {r.get("ac"): r for r in draft.get("coverage") or []}
            counts: dict[str, int] = {}
            for a in acs:
                res = (rows.get(a["id"]) or {}).get("result") or "未実施"
                counts[res] = counts.get(res, 0) + 1
            return {"kind": "ac_coverage", "total": len(acs), "counts": counts,
                    "missing": [a["id"] for a in acs if a["id"] not in rows]}
        return None

    def import_acceptance(self, product: Product, user: str) -> int:
        """⑥の受入基準を⑬の網羅表に取り込む。入っている結果は残し、足りない行だけ足す。"""
        self._stage(product, "s13")
        acs = [r for r in self._data(product, "s06").get("acceptance") or [] if r.get("id")]
        rows = [dict(r) for r in repo.draft(product.id, "s13").get("coverage") or []]
        have = {r.get("ac") for r in rows}
        added = 0
        for a in acs:
            criterion = f"{a.get('given', '')} ／ {a.get('when', '')} → {a.get('then', '')}".strip(" ／→")
            if a["id"] in have:
                for r in rows:
                    if r.get("ac") == a["id"]:
                        r["story"], r["criterion"] = a.get("story", ""), criterion
            else:
                rows.append({"ac": a["id"], "story": a.get("story", ""), "criterion": criterion, "result": "未実施",
                             "evidence": "", "note": ""})
                added += 1
        f = fx.FRAMEWORK_BY_STAGE["s13"].get("coverage")
        repo.set_fields(product.id, "s13", {"coverage": fx.coerce(f, rows)}, user, "import")
        return added

    @staticmethod
    def _references(product: Product, stage_id: str, rs: dict) -> list[dict]:
        """事業フェーズ（P1〜P2）の成果物。最新版があれば最新版、なければ下書きを Markdown で返す。"""
        out = []
        for st in STAGES:
            if st.phase not in ("P1", "P2") or st.id == stage_id or not rs[st.id].enabled:
                continue
            art = repo.confirmed_artifact(product.id, st.id)
            if art is not None:
                md, source = art.content, f"最新版 v{art.version}"
            else:
                md, source = fx.to_markdown(st, fx.FRAMEWORK_BY_STAGE[st.id], repo.draft(product.id, st.id)), "下書き"
            out.append({"id": st.id, "no": st.no, "name": st.name, "framework": fx.FRAMEWORK_BY_STAGE[st.id].title,
                        "status": rs[st.id].status, "source": source, "markdown": md})
        return out


def product_dict(p: Product) -> dict:
    return {"id": p.id, "name": p.name, "idea": p.idea, "scope": p.scope, "mode": p.mode,
            "status": p.status, "cover_image_id": p.cover_image_id, "created_by": p.created_by,
            "created_at": p.created_at.isoformat()}
