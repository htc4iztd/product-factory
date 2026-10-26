"""報告資料（RP-n）：各工程で決めた企画情報から範囲を選び、AI がスライドの構成にまとめる。

ジョブ（report）：選んだ項目を集める（collect）→ 構成と本文を作る（outline）→ 表を付録にする（appendix）
- 本文のスライドは「1枚1メッセージ」。タイトルは結論、根拠にした工程を sources に持つ
- 付録は選んだ表・処理仕様（CRUD マトリクス）を、そのまま表のスライドにする（AI を通さない）
画面でスライドを直し、PowerPoint と Markdown に書き出す。
"""
from __future__ import annotations

from pydantic import BaseModel
from sqlalchemy import func, select

from . import designs, jobs, llm, llmconf, repo
from . import frameworks as fx
from .db import JobRun, Product, ProductReport, session
from .stages import STAGE_BY_ID, STAGES

jobs.JOBS["report"] = jobs.JobDef(
    "report",
    "報告資料の作成",
    "各工程の企画情報から選んだ範囲を読み、読み手と目的に合わせてスライドの構成と本文を作る。表は付録にそのまま付ける。",
    "プロダクトの「報告資料」",
    20,
)
ROWS_PER_SLIDE = 12


class ReportError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


class SlideOut(BaseModel):
    title: str
    message: str
    bullets: list[str]
    sources: list[str]
    notes: str


class DeckOut(BaseModel):
    summary: str
    slides: list[SlideOut]


def report_dict(r: ProductReport) -> dict:
    return {"number": r.number, "key": f"RP-{r.number}", "title": r.title, "audience": r.audience,
            "purpose": r.purpose, "selection": r.selection, "source": r.source, "slides_hint": r.slides_hint,
            "status": r.status, "data": r.data, "error": r.error, "job_id": r.job_id, "created_by": r.created_by,
            "created_at": r.created_at.isoformat(), "updated_at": r.updated_at.isoformat()}


def sources(product: Product) -> list[dict]:
    """選べる範囲：工程ごとの項目と、中身があるか・どの版か。"""
    rs = repo.runs(product.id)
    out = []
    for st in STAGES:
        r = rs.get(st.id)
        fw = fx.FRAMEWORK_BY_STAGE[st.id]
        art = repo.confirmed_artifact(product.id, st.id)
        data = art.data if art is not None and art.data else repo.draft(product.id, st.id)
        out.append({"id": st.id, "no": st.no, "name": st.name, "phase": st.phase,
                    "enabled": r.enabled if r is not None else True,
                    "version": art.version if art is not None and art.data else None,
                    "fields": [{"key": f.key, "label": f.label, "kind": f.kind,
                                "filled": fx.is_filled(f, data.get(f.key))} for f in fw.fields]})
    return out


def _clean_selection(selection: list[dict]) -> list[dict]:
    out = []
    for it in selection or []:
        sid = str(it.get("stage", ""))
        if sid not in STAGE_BY_ID:
            raise ReportError(422, f"不明な工程：{sid}")
        fw = fx.FRAMEWORK_BY_STAGE[sid]
        keys = [k for k in it.get("fields") or [] if fw.get(k) is not None] or [f.key for f in fw.fields]
        out.append({"stage": sid, "fields": keys})
    if not out:
        raise ReportError(422, "報告に使う工程・項目を選んでください")
    return out


def create(product: Product, user: str, title: str, audience: str, purpose: str, selection: list[dict],
           source: str, slides_hint: int) -> dict:
    if not title.strip():
        raise ReportError(422, "題を入れてください")
    if source not in ("latest", "draft"):
        raise ReportError(422, "source は latest か draft です")
    sel = _clean_selection(selection)
    with session() as s:
        n = (s.execute(select(func.max(ProductReport.number)).where(ProductReport.product_id == product.id))
             .scalar() or 0) + 1
        r = ProductReport(tenant_id=product.tenant_id, product_id=product.id, number=n, title=title.strip()[:300],
                          audience=audience.strip()[:300], purpose=purpose.strip()[:4000], selection=sel,
                          source=source, slides_hint=max(3, min(slides_hint, 30)), created_by=user)
        s.add(r)
        s.commit()
    return _start(product, user, n)


def _start(product: Product, user: str, number: int) -> dict:
    conn = llmconf.resolve(product.tenant_id)
    job_id = jobs.create("report", product.tenant_id, product.id, user, {"number": number}, total=3,
                         model=conn.summary_model,
                         tasks=[{"id": "collect", "name": "選んだ項目を集める", "deps": []},
                                {"id": "outline", "name": "構成と本文を作る", "deps": ["collect"]},
                                {"id": "appendix", "name": "表を付録にする", "deps": ["collect"]}])
    with session() as s:
        r = _get(s, product.id, number)
        r.job_id, r.status, r.error = job_id, "queued", ""
        s.commit()
    jobs.dispatch(job_id)
    return get(product, number)


def regenerate(product: Product, user: str, number: int) -> dict:
    with session() as s:
        _get(s, product.id, number)
    return _start(product, user, number)


def _get(s, product_id: str, number: int) -> ProductReport:
    r = s.execute(select(ProductReport).where(ProductReport.product_id == product_id,
                                              ProductReport.number == number)).scalar_one_or_none()
    if r is None:
        raise ReportError(404, f"RP-{number} はありません")
    return r


def get(product: Product, number: int) -> dict:
    with session() as s:
        return report_dict(_get(s, product.id, number))


def list_reports(product: Product) -> list[dict]:
    with session() as s:
        rows = s.execute(select(ProductReport).where(ProductReport.product_id == product.id)
                         .order_by(ProductReport.number.desc())).scalars()
        return [report_dict(r) for r in rows]


def update(product: Product, number: int, title: str | None, data: dict | None) -> dict:
    with session() as s:
        r = _get(s, product.id, number)
        if title is not None:
            if not title.strip():
                raise ReportError(422, "題が空です")
            r.title = title.strip()[:300]
        if data is not None:
            slides = data.get("slides")
            if not isinstance(slides, list) or not all(isinstance(x, dict) for x in slides):
                raise ReportError(422, "slides はスライドの配列です")
            r.data = {**(r.data or {}), "summary": str(data.get("summary", (r.data or {}).get("summary", ""))),
                      "slides": slides}
        s.commit()
        return report_dict(r)


def delete(product: Product, number: int) -> None:
    with session() as s:
        s.delete(_get(s, product.id, number))
        s.commit()


# ---------------- ジョブ ----------------
def _collect(product: Product, sel: list[dict], source: str) -> tuple[dict[str, dict], dict[str, str]]:
    """工程ごとの値（選んだ項目だけ）と、使った版。"""
    data, basis = {}, {}
    for it in sel:
        sid = it["stage"]
        art = repo.confirmed_artifact(product.id, sid) if source == "latest" else None
        if art is not None and art.data:
            d, basis[sid] = art.data, f"v{art.version}"
        else:
            d, basis[sid] = repo.draft(product.id, sid), "下書き"
        if sid in fx.LEGACY_SECTIONS:
            d = fx.upgrade(sid, d)
        data[sid] = {k: d.get(k) for k in it["fields"]}
    return data, basis


def _markdown(sid: str, values: dict) -> str:
    st, fw = STAGE_BY_ID[sid], fx.FRAMEWORK_BY_STAGE[sid]
    sub = fx.Framework(fw.view, fw.title, fw.summary, tuple(f for f in fw.fields if f.key in values))
    return fx.to_markdown(st, sub, values)


def _cell(v) -> str:
    return str(v if v is not None else "").replace("\n", " ")[:200]


def appendix(data: dict[str, dict]) -> list[dict]:
    """選んだ表は付録の表のスライドにする（多い行は分ける）。処理仕様は CRUD マトリクスにする。"""
    out = []
    for sid, values in data.items():
        st, fw = STAGE_BY_ID[sid], fx.FRAMEWORK_BY_STAGE[sid]
        for f in fw.fields:
            v = values.get(f.key)
            if f.key not in values or not fx.is_filled(f, v):
                continue
            if f.kind == "table":
                rows = fx.pl_rows(v) if (sid == "s05" and f.key == "pl") else v
                head = [c.label for c in f.columns]
                body = [[_cell(r.get(c.key)) for c in f.columns] for r in rows]
            elif f.kind == designs.SP:
                m = designs.crud_matrix(v, values.get("data_model") or {})
                head = ["処理"] + m["tables"]
                body = [[f"{r['id']} {r['name']}"] + [r["cells"].get(t, "") for t in m["tables"]] for r in m["rows"]]
            elif f.kind == designs.ER:
                head = ["エンティティ", "物理名", "主キー", "属性"]
                body = [[e["name"], e["physical"], "・".join(a["name"] for a in e["attrs"] if a["pk"]),
                         "・".join(a["name"] for a in e["attrs"] if not a["pk"])[:200]] for e in v["entities"]]
            elif f.kind == designs.GR:
                head = ["リソース", "種類", "置き場所", "説明"]
                body = [[n["label"], designs.NODE_KINDS[n["kind"]], n["zone"], n["note"]] for n in v["nodes"]]
            else:
                continue
            for i in range(0, len(body), ROWS_PER_SLIDE):
                part = f"（{i // ROWS_PER_SLIDE + 1}）" if len(body) > ROWS_PER_SLIDE else ""
                out.append({"kind": "table", "title": f"{st.no}{st.name}：{f.label}{part}", "message": "",
                            "bullets": [], "sources": [sid], "notes": "",
                            "table": {"head": head, "rows": body[i:i + ROWS_PER_SLIDE]}})
    return out


def _outline(conn, product: Product, r: dict, md: str) -> DeckOut:
    if conn.provider == "stub":
        llm._record("stub", 0, 0)
        slides = []
        for sid in [it["stage"] for it in r["selection"]]:
            st = STAGE_BY_ID[sid]
            slides.append(SlideOut(title=f"{st.name}の要点（仮）", message=f"{st.no}{st.name}で決めたこと",
                                   bullets=[f"{st.name}の要点1（スタブ）", f"{st.name}の要点2（スタブ）"],
                                   sources=[sid], notes=""))
        return DeckOut(summary=f"「{r['title']}」の要約（スタブ）", slides=slides)
    prompt = (
        f"プロダクト「{product.name}」の報告資料「{r['title']}」のスライドを作ります。\n"
        f"- 読み手：{r['audience'] or '（指定なし）'}\n- 目的：{r['purpose'] or '（指定なし）'}\n"
        f"- 本文のスライドはおよそ {r['slides_hint']} 枚（表紙と付録は別に付けるので含めない）\n\n"
        "## 書き方\n"
        "- 1枚に1つのメッセージ。title はそのスライドの結論を1文で（体言止めや「〜について」にしない）。\n"
        "- message は title を支える一言（40字以内）。bullets は根拠・内訳を3〜5個、各60字以内。\n"
        "- 下の企画情報に書かれていることだけを使う。数値・ID・名前はそのまま使い、無いことは書かない。"
        "決まっていないことは「未決」と書く。\n"
        "- 最初の1枚は全体の結論（何を、なぜ、次に何を決めてほしいか）。最後の1枚は次の打ち手と判断してほしいこと。\n"
        "- sources には根拠にした工程の id（s01 など）を入れる。notes には話すときの補足を書く。\n"
        "- summary は資料全体の要約（3文以内）。\n\n"
        f"## 企画情報（各工程で決めたこと）\n{md[:150000]}\n"
    )
    return llm._json(conn, conn.summary_model, prompt, DeckOut)


def run(job_id: str) -> None:
    with session() as s:
        j = s.get(JobRun, job_id)
        r = _get(s, j.product_id, j.params["number"])
        product = s.get(Product, j.product_id)
        s.expunge(product)
        r.status = "running"
        s.commit()
        info = report_dict(r)
    conn = llmconf.resolve(product.tenant_id)
    try:
        with jobs.task(job_id, "collect"):
            data, basis = _collect(product, info["selection"], info["source"])
            md = "\n\n".join(_markdown(sid, v) for sid, v in data.items())
            jobs.set_task(job_id, "collect", detail=f"{len(data)}工程・{len(md)}文字")
        with jobs.task(job_id, "outline"):
            deck = _outline(conn, product, info, md)
            valid = set(data)
            slides = [{"kind": "content", **s.model_dump(), "sources": [x for x in s.sources if x in valid]}
                      for s in deck.slides]
            jobs.set_task(job_id, "outline", detail=f"{len(slides)}枚")
        with jobs.task(job_id, "appendix"):
            extra = appendix(data)
            jobs.set_task(job_id, "appendix", detail=f"{len(extra)}枚")
        with session() as s:
            r = _get(s, product.id, info["number"])
            r.status, r.data = "done", {"summary": deck.summary, "slides": slides + extra, "basis": basis,
                                        "model": conn.summary_model}
            s.commit()
    except Exception as e:
        with session() as s:
            r = _get(s, product.id, info["number"])
            r.status, r.error = "failed", (getattr(e, "message", None) or str(e))[:500]
            s.commit()
        raise


jobs.HANDLERS["report"] = run
