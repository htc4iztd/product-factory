"""資料の取り込み：Office の資料を読み、どの工程のどの項目にあたるかを見分けて、項目に入れる。

1. 受け付けたときに資料を文章にする（office.py）。文章は import_docs に置く
2. ジョブ：どの工程の資料か見分ける（route）→ 工程ごとに項目の値を抜き出す（map:sNN）→ 入れる（apply）
入れ方は2つ。
- propose：すべて AI の案として、その工程の対話（「資料の取り込み：ファイル名」セッション）に出す。人が採用すると入る
- fill：空の項目には直接入れ、すでに値がある項目は案として出す（上書きはしない）
資料に書かれていないことは入れない（推測で埋めない）。
"""
from __future__ import annotations

import base64
import binascii
import json
import uuid

from pydantic import BaseModel
from sqlalchemy import select

from . import frameworks as fx
from . import jobs, llm, llmconf, office, repo
from .db import ImportDoc, JobRun, Product, session
from .stages import STAGE_BY_ID, STAGES

jobs.JOBS["import"] = jobs.JobDef(
    "import",
    "資料の取り込み",
    "アップロードした Office の資料（Excel・Word・PowerPoint）を読み、どの工程のどの項目にあたるかを見分けて、"
    "空の項目に入れるか、AI の案として各工程の対話に出す。",
    "プロダクトの「資料を取り込む」",
    30,
)

MODES = ("propose", "fill")
DOC_CHARS = 120_000   # 項目を抜き出すときに AI に渡す本文の長さ


class ImportsError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


class RouteItem(BaseModel):
    stage: str
    fields: list[str]
    why: str


class Routing(BaseModel):
    stages: list[RouteItem]


def doc_dict(d: ImportDoc, full: bool = False) -> dict:
    out = {"id": d.id, "filename": d.filename, "kind": d.kind, "kind_label": office.KINDS.get(d.kind, d.kind),
           "size": d.size, "chars": len(d.text or ""), "mode": d.mode, "stages": d.stages or [], "status": d.status,
           "result": d.result or [], "job_id": d.job_id, "created_by": d.created_by,
           "created_at": d.created_at.isoformat(), "outline": d.outline or []}
    if full:
        out["preview"] = (d.text or "")[:6000]
    return out


def _candidates(product_id: str, only: list[str] | None) -> list[str]:
    """割り当て先の候補：使っている（閉じていない）工程。⑫以降（コード・テスト結果・リリース記録）は資料から作らない。"""
    rs = repo.runs(product_id)
    return [s.id for s in STAGES if s.id not in ("s12", "s14") and (not only or s.id in only)
            and (rs[s.id].enabled if s.id in rs else True)]


def start(product: Product, user: str, filename: str, content_b64: str, mode: str, stages: list[str]) -> dict:
    filename = (filename or "").strip().replace("/", "_")[:300]
    if mode not in MODES:
        raise ImportsError(422, "入れ方は propose か fill です")
    bad = [s for s in stages or [] if s not in STAGE_BY_ID]
    if bad:
        raise ImportsError(422, f"不明な工程：{', '.join(bad)}")
    try:
        data = base64.b64decode(content_b64, validate=True)
    except (binascii.Error, ValueError):
        raise ImportsError(422, "ファイルの中身を読めません") from None
    try:
        kind = office.kind_of(filename)
        text, outline = office.extract(filename, data)
    except office.OfficeError as e:
        raise ImportsError(422, e.message) from None
    if len(text.strip()) < 20:
        raise ImportsError(422, "資料から文字を読み取れませんでした（画像だけの資料は読めません）")
    conn = llmconf.resolve(product.tenant_id)
    with session() as s:
        d = ImportDoc(tenant_id=product.tenant_id, product_id=product.id, filename=filename, kind=kind, size=len(data),
                      text=text, outline=outline, mode=mode, stages=stages or None, created_by=user)
        s.add(d)
        s.commit()
        doc_id = d.id
    job_id = jobs.create("import", product.tenant_id, product.id, user, {"doc": doc_id, "filename": filename},
                         total=3, model=conn.chat_model,
                         tasks=[{"id": "route", "name": "どの工程の資料か見分ける", "deps": []}])
    with session() as s:
        s.get(ImportDoc, doc_id).job_id = job_id
        s.commit()
    jobs.dispatch(job_id)
    return get(product, doc_id)


def list_docs(product: Product) -> list[dict]:
    with session() as s:
        rows = s.execute(select(ImportDoc).where(ImportDoc.product_id == product.id)
                         .order_by(ImportDoc.id.desc()).limit(100)).scalars()
        return [doc_dict(d) for d in rows]


def get(product: Product, doc_id: int) -> dict:
    with session() as s:
        d = s.get(ImportDoc, doc_id)
        if d is None or d.product_id != product.id:
            raise ImportsError(404, "取り込んだ資料が見つかりません")
        return doc_dict(d, full=True)


# ---------------- ジョブ ----------------
def _fields_brief(sid: str) -> str:
    fw = fx.FRAMEWORK_BY_STAGE[sid]
    st = STAGE_BY_ID[sid]
    fields = "／".join(f"{f.key}:{f.label}" + (f"（{f.hint[:40]}）" if f.hint else "") for f in fw.fields)
    return f"- {sid} {st.no}{st.name}（{fw.title}）：{fields}"


def _route(conn, text: str, outline: list[str], candidates: list[str]) -> list[RouteItem]:
    if conn.provider == "stub":
        llm._record("stub", 0, 0)
        out = []
        for sid in candidates:
            fw = fx.FRAMEWORK_BY_STAGE[sid]
            hit = [f.key for f in fw.fields if f.label in text]
            if hit:
                out.append(RouteItem(stage=sid, fields=hit, why="項目名が資料に出てくる"))
        return out[:6]
    prompt = (
        "次の資料が、プロダクト開発のどの工程のどの項目にあたる内容を含むかを見分けてください。\n"
        "- 資料に具体的な中身（表・手順・値・定義）がある項目だけを選ぶ。名前が出てくるだけの項目は選ばない。\n"
        "- 工程は多くても6つ。stage は下の一覧の id（s01 など）、fields は項目の key。\n"
        "- why には、資料のどこ（シート名・スライド・章）が根拠かを短く書く。\n\n"
        "## 工程と項目\n" + "\n".join(_fields_brief(s) for s in candidates) + "\n\n"
        "## 資料の見出し\n" + "\n".join(f"- {h}" for h in outline[:200]) + "\n\n"
        f"## 資料（冒頭）\n{text[:40000]}\n"
    )
    r = llm._json(conn, conn.chat_model, prompt, Routing)
    ok = []
    for it in r.stages:
        if it.stage in candidates:
            fw = fx.FRAMEWORK_BY_STAGE[it.stage]
            keys = [k for k in it.fields if fw.get(k) is not None]
            if keys:
                ok.append(RouteItem(stage=it.stage, fields=keys, why=it.why))
    return ok[:6]


def _map(conn, product: Product, sid: str, keys: list[str], text: str, filename: str) -> list[llm.Proposal]:
    st, fw = STAGE_BY_ID[sid], fx.FRAMEWORK_BY_STAGE[sid]
    fields = [f for f in fw.fields if f.key in keys]
    if conn.provider == "stub":
        llm._record("stub", 0, 0)
        out = []
        for f in fields:
            if f.kind == "text":
                i = text.find(f.label)
                out.append(llm.Proposal(field=f.key, value=text[max(0, i):max(0, i) + 300].strip(),
                                        reason=f"資料「{filename}」の「{f.label}」の箇所"))
            else:
                out.append(llm.Proposal(field=f.key, value=llm._stub_value(f, product.idea),
                                        reason=f"資料「{filename}」から（スタブ）"))
        return out
    sub = fx.Framework(fw.view, fw.title, fw.summary, tuple(fields))
    draft = repo.draft(product.id, sid)
    prompt = (
        f"資料「{filename}」の中身を、プロダクト「{product.name}」の"
        f"「{st.no} {st.name}」（{fw.title}）の項目に移します。\n"
        "## 決まり\n"
        "- 資料に書かれていることだけを使う。資料にないことを推測で補わない。"
        "資料に中身がない項目は proposals に入れない。\n"
        "- 資料の言い回し・ID・名前・数値はできるだけそのまま使う。表は資料の行を落とさずに移す。\n"
        "- 現在の値がある項目は、資料の内容で置き換えるか、資料の内容を足した値にする。"
        "reason に資料のどこから取ったかを書く。\n"
        "- reply には、移せなかったこと・資料の中で食い違っていることを短く書く。\n"
        + llm.value_rules(sub) + "\n"
        f"## 項目の定義\n{json.dumps(fx.spec(sub), ensure_ascii=False)}\n\n"
        f"## 現在の値\n{json.dumps({f.key: draft.get(f.key) for f in fields}, ensure_ascii=False)}\n\n"
        f"## 資料\n{text[:DOC_CHARS]}\n"
    )
    return llm._json(conn, conn.chat_model, prompt, llm.Turn).proposals


def _apply(product: Product, user: str, sid: str, props: list[llm.Proposal], mode: str, filename: str,
           model: str) -> list[dict]:
    fw = fx.FRAMEWORK_BY_STAGE[sid]
    draft = repo.draft(product.id, sid)
    out, pending = [], []
    for p in props:
        f = fw.get(p.field)
        if f is None:
            continue
        try:
            value = fx.coerce(f, p.value)
        except (ValueError, TypeError) as e:
            out.append({"stage": sid, "field": f.key, "label": f.label, "action": "dropped",
                        "reason": f"値の形が合わない（{str(e)[:120]}）"})
            continue
        if not fx.is_filled(f, value):
            continue
        if mode == "fill" and not fx.is_filled(f, draft.get(f.key)):
            repo.set_field(product.id, sid, f.key, value, user, "import")
            out.append({"stage": sid, "field": f.key, "label": f.label, "action": "filled", "reason": p.reason})
        else:
            pending.append({"id": uuid.uuid4().hex[:10], "field": f.key, "value": value,
                            "reason": p.reason, "status": "pending"})
            out.append({"stage": sid, "field": f.key, "label": f.label, "action": "proposed", "reason": p.reason})
    if pending:
        cs = repo.create_session(product.id, sid, user, f"資料の取り込み：{filename}"[:200])
        repo.add_chat(product.id, sid, "assistant", f"import-agent ({model})",
                      f"資料「{filename}」から {len(pending)} 項目の案を作りました。採用するものを選んでください。",
                      pending, session_id=cs)
    return out


def run(job_id: str) -> None:
    with session() as s:
        j = s.get(JobRun, job_id)
        d = s.get(ImportDoc, j.params["doc"])
        product = s.get(Product, d.product_id)
        s.expunge(product)
        d.status = "running"
        s.commit()
        doc_id, text, outline, mode, only, filename, user = (d.id, d.text, d.outline or [], d.mode, d.stages,
                                                              d.filename, j.created_by)
    conn = llmconf.resolve(product.tenant_id)
    try:
        with jobs.task(job_id, "route"):
            routes = _route(conn, text, outline, _candidates(product.id, only))
            hits = "、".join(f"{STAGE_BY_ID[r.stage].no}{len(r.fields)}項目" for r in routes)
            jobs.set_task(job_id, "route", detail=hits or "あてはまる工程なし")
        jobs.define_tasks(job_id, [
            *({"id": f"map:{r.stage}", "name": f"{STAGE_BY_ID[r.stage].no}{STAGE_BY_ID[r.stage].name}の項目を抜き出す",
               "group": "抜き出す", "deps": ["route"]} for r in routes),
            {"id": "apply", "name": "項目に入れる・案を出す", "deps": [f"map:{r.stage}" for r in routes] or ["route"]},
        ])
        found: dict[str, list[llm.Proposal]] = {}
        for r in routes:
            jobs.step(job_id, f"{STAGE_BY_ID[r.stage].name}を抜き出しています", advance=False)
            with jobs.task(job_id, f"map:{r.stage}"):
                found[r.stage] = _map(conn, product, r.stage, r.fields, text, filename)
                jobs.set_task(job_id, f"map:{r.stage}", detail=f"{len(found[r.stage])}項目")
        result: list[dict] = []
        with jobs.task(job_id, "apply"):
            for sid, props in found.items():
                result += _apply(product, user, sid, props, mode, filename, conn.chat_model)
            n = {a: sum(1 for x in result if x["action"] == a) for a in ("filled", "proposed", "dropped")}
            jobs.set_task(job_id, "apply", detail=f"入れた {n['filled']}・案 {n['proposed']}・外した {n['dropped']}")
        with session() as s:
            d = s.get(ImportDoc, doc_id)
            d.status, d.result = "done", result
            s.commit()
    except Exception:
        with session() as s:
            s.get(ImportDoc, doc_id).status = "failed"
            s.commit()
        raise


jobs.HANDLERS["import"] = run
