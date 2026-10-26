"""以降の工程の自動開発：上流で決めたことに従い、パターン（案）ごとに後工程の下書きと動く試作を作る。

1. 上流（押したステージまで）の最新版、なければ下書きを読む
2. AI が違いのはっきりした N 個のパターンを決める（人が軸を指定したらそれに従う）
3. パターンごとに、後工程（押したステージより後、⑪運用方式設計まで）の下書きを順に作る。前の工程の結果を次に渡す
4. パターンごとに、⑥の画面とストーリーから、ブラウザで触れる単一ファイルの試作（HTML）を作る

作ったものはプリプロダクト（PP-n）として残し、人が比べて1つを採用すると、その下書きが本線の各ステージに入る。
長くかかるので、ジョブ（jobs.py。Cloud Run では Cloud Run Jobs）として動かす。
"""
from __future__ import annotations

import contextvars
import datetime as dt
import html
from concurrent.futures import ThreadPoolExecutor

from pydantic import BaseModel
from sqlalchemy import func, select

from . import frameworks as fx
from . import jobs, llm, llmconf, ontology, repo
from .db import JobRun, Product, Variant, session
from .llmconf import Conn
from .stages import STAGE_BY_ID, STAGES

LAST_STAGE = "s11"   # ⑫以降（コード・テスト・リリース）は、採用した案から作る


class AutodevError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


class Pattern(BaseModel):
    title: str              # 「案A：最小限で早く出す」のような短い名前
    concept: str            # この案の考え方と、他の案との違い（2〜4文）
    assumptions: list[str]  # この案が置く前提


class Patterns(BaseModel):
    patterns: list[Pattern]


def targets(product_id: str, from_stage: str) -> list[str]:
    rs = repo.runs(product_id)
    order = [s.id for s in STAGES]
    if from_stage not in order:
        raise AutodevError(404, f"unknown stage {from_stage}")
    after = order[order.index(from_stage) + 1: order.index(LAST_STAGE) + 1]
    return [sid for sid in after if rs[sid].enabled]


def _upstream(product_id: str, until: str) -> tuple[dict[str, str], dict]:
    """押したステージまでの使用中ステージ：最新版があれば最新版、なければ下書き（Markdown）。"""
    rs = repo.runs(product_id)
    order = [s.id for s in STAGES]
    out, based = {}, {}
    for sid in order[: order.index(until) + 1]:
        if not rs[sid].enabled:
            continue
        st, fw = STAGE_BY_ID[sid], fx.FRAMEWORK_BY_STAGE[sid]
        art = repo.confirmed_artifact(product_id, sid)
        data = art.data if art is not None and art.data else repo.draft(product_id, sid)
        based[sid] = art.version if art is not None and art.data else "draft"
        out[f"{st.no} {st.name}"] = fx.to_markdown(st, fw, data)
    return out, based


# ---------------- 依頼 ----------------
def start(product: Product, user: str, from_stage: str, count: int, hint: str) -> dict:
    if product.status != "active":
        raise AutodevError(409, "このプロダクトは中止されています")
    if not 1 <= count <= 4:
        raise AutodevError(422, "案の数は 1〜4")
    stages = targets(product.id, from_stage)
    if not stages:
        raise AutodevError(409, "このステージより後に、自動で作れるステージ（⑪まで・使用中）がありません")
    with session() as s:
        busy = s.execute(select(JobRun).where(JobRun.product_id == product.id, JobRun.kind == "autodev",
                                              JobRun.status.in_(("queued", "running")))).first()
        if busy:
            raise AutodevError(409, "自動開発が実行中です。終わってから次を始めてください")
    _, based = _upstream(product.id, from_stage)
    conn = llmconf.resolve(product.tenant_id)
    params = {"from_stage": from_stage, "stages": stages, "count": count, "hint": hint.strip(), "based_on": based}
    job_id = jobs.create("autodev", product.tenant_id, product.id, user, params,
                         total=1 + count * (len(stages) + 1), model=conn.chat_model)
    repo.log(product.id, from_stage, "human", user, "autodev.start", {"job": job_id, **params})
    jobs.dispatch(job_id)
    return jobs.run_dict(job_id)


def retry(product: Product, user: str, job_id: str) -> dict:
    j = jobs.get(job_id, product.tenant_id)
    if j["product_id"] != product.id or j["kind"] != "autodev":
        raise AutodevError(404, "ジョブがありません")
    p = j["params"]
    return start(product, user, p["from_stage"], p["count"], p.get("hint", ""))


# ---------------- 実行（ジョブの中） ----------------
def run(job_id: str) -> None:
    with session() as s:
        j = s.get(JobRun, job_id)
        product = s.get(Product, j.product_id)
        p = dict(j.params)
    from_stage, stages, count, hint = p["from_stage"], list(p["stages"]), p["count"], p.get("hint", "")
    conn = llmconf.resolve(product.tenant_id)
    upstream, _ = _upstream(product.id, from_stage)
    onto = ontology.context_for(product.tenant_id, product.idea + "\n".join(upstream.values()))
    if onto:
        upstream["社内の用語と関係"] = onto
    jobs.step(job_id, "パターンを決めています", advance=False)
    patterns = plan(conn, product, upstream, stages, count, hint)
    jobs.step(job_id, "パターンを決めました：" + "／".join(x.title for x in patterns))
    with session() as s:
        base = s.execute(select(func.max(Variant.number)).where(Variant.product_id == product.id)).scalar() or 0
        ids = []
        for i, pt in enumerate(patterns):
            v = Variant(product_id=product.id, run_id=job_id, number=base + i + 1, title=pt.title[:200],
                        concept=pt.concept, assumptions=pt.assumptions, drafts={})
            s.add(v)
            s.flush()
            ids.append(v.id)
        s.commit()
    # 案ごとに並べて作る。使用量の記録（contextvars）を引き継ぐため、送り出す側で文脈を複製してから渡す
    ctxs = [contextvars.copy_context() for _ in ids]
    with ThreadPoolExecutor(max_workers=min(len(ids), 3)) as pool:
        results = list(pool.map(lambda c_v: c_v[0].run(_build_variant, job_id, conn, product, c_v[1], upstream,
                                                        stages), zip(ctxs, ids, strict=True)))
    if any(isinstance(r, jobs.Cancelled) for r in results):
        raise jobs.Cancelled()
    failed = sum(1 for r in results if isinstance(r, Exception))
    if failed == len(ids):
        raise AutodevError(502, f"すべての案を作れませんでした（{results[0]}）")
    repo.log(product.id, from_stage, "agent", f"autodev ({conn.chat_model})", "autodev.done",
             {"job": job_id, "pre_products": len(ids), "failed": failed})


def _build_variant(job_id: str, conn: Conn, product: Product, vid: int, upstream: dict[str, str],
                   stages: list[str]) -> Exception | None:
    with session() as s:
        v = s.get(Variant, vid)
        title, concept, assumptions = v.title, v.concept, list(v.assumptions or [])
    drafts: dict[str, dict] = {}
    try:
        for sid in stages:
            st, fw = STAGE_BY_ID[sid], fx.FRAMEWORK_BY_STAGE[sid]
            ups = dict(upstream)
            ups["この案（パターン）"] = f"{title}\n{concept}\n前提：" + "／".join(assumptions)
            for prev, d in drafts.items():   # この案ですでに作った後工程
                ups[f"{STAGE_BY_ID[prev].no} {STAGE_BY_ID[prev].name}（この案）"] = fx.to_markdown(
                    STAGE_BY_ID[prev], fx.FRAMEWORK_BY_STAGE[prev], d)
            turn = llm.converse(conn, st, fw, product.idea, fx.empty_draft(fw), ups, [],
                                f"「{title}」の考え方と前提に従い、上流の決定と矛盾しないように、すべての項目の下書きを作ってください。"
                                "この案らしさ（他の案との違い）が項目に表れるようにしてください。")
            d = fx.empty_draft(fw)
            for p in turn.proposals:
                f = fw.get(p.field)
                if f is None:
                    continue
                try:
                    d[f.key] = fx.coerce(f, p.value)
                except (ValueError, TypeError):
                    continue
            drafts[sid] = d
            with session() as s:
                s.get(Variant, vid).drafts = dict(drafts)
                s.commit()
            jobs.step(job_id, f"{title}：{st.no} {st.name}")
        spec = drafts.get("s06") or repo.draft(product.id, "s06")
        page = prototype(conn, product, title, concept, spec, drafts)
        with session() as s:
            v = s.get(Variant, vid)
            v.prototype, v.status = page, "ready"
            s.commit()
        jobs.step(job_id, f"{title}：試作")
        return None
    except Exception as e:  # noqa: BLE001  この案だけ失敗にして、他の案は続ける（取り消しは呼び出し元へ返す）
        with session() as s:
            v = s.get(Variant, vid)
            v.status, v.error = ("failed", (str(e)[:500] or type(e).__name__)) if not isinstance(
                e, jobs.Cancelled) else ("failed", "取り消し")
            s.commit()
        return e


# ---------------- AI に頼むこと ----------------
LABELS = "ABCD"


def plan(conn: Conn, product: Product, upstream: dict[str, str], stages: list[str], count: int,
         hint: str) -> list[Pattern]:
    if conn.provider == "stub":
        axes = [a.strip() for a in hint.replace("、", ",").split(",") if a.strip()] if hint else []
        base = [("最小限で早く出す", "必要最小限の機能だけで最短で出し、使われ方から学ぶ。"),
                ("体験を作り込む", "主要な体験を磨き込み、最初から選ばれる理由を作る。"),
                ("自動化に寄せる", "人手の作業を減らし、運用の手間と費用を抑える。"),
                ("連携で広げる", "既存のツールやサービスとつなぎ、使う場面を広げる。")]
        out = []
        for i in range(count):
            name, desc = (axes[i], f"「{axes[i]}」を軸にした案。") if i < len(axes) else base[i]
            out.append(Pattern(title=f"案{LABELS[i]}：{name}", concept=desc, assumptions=[f"{name}を優先する"]))
        return out
    ups = "\n\n".join(f"### {k}\n{v}" for k, v in upstream.items())
    names = "、".join(f"{STAGE_BY_ID[s].no}{STAGE_BY_ID[s].name}" for s in stages)
    prompt = (
        f"プロダクト「{product.name}」（{product.idea}）について、上流で決めたことは下のとおりです。"
        f"これに従ったうえで、後工程（{names}）の作り方が大きく変わる {count} 個のパターン（案）を出してください。\n"
        "- 案どうしの違いは、範囲・体験・技術構成・運用のどれかで、はっきり比べられるものにする。似た案を並べない。\n"
        "- どの案も上流の決定（顧客・課題・価値提案・指標など）には反しない。\n"
        f"- title は「案A：〜」「案B：〜」の形の短い名前。concept は考え方と他の案との違いを2〜4文で。\n"
        + (f"- 人が指定した違いの軸：{hint}。この軸で案を分ける。\n" if hint else "")
        + f"\n## 上流で決めたこと\n{ups[-60000:]}\n"
    )
    out = llm._json(conn, conn.chat_model, prompt, Patterns).patterns[:count]
    if not out:
        raise AutodevError(502, "AI がパターンを返しませんでした")
    return out


PROTO_RULES = (
    "- 1つの HTML ファイルで完結させる。CSS と JavaScript は埋め込み、"
    "外部のファイル・フォント・画像・通信は使わない。\n"
    "- データは JavaScript の中のサンプルで持ち、"
    "画面の切り替え・入力・一覧の追加などの主な操作が実際に動くようにする。\n"
    "- 日本語。スマホでも崩れない。上部に「試作：<案の名前>」と表示する。\n"
)


def prototype(conn: Conn, product: Product, title: str, concept: str, spec: dict, drafts: dict) -> str:
    if conn.provider == "stub":
        return _stub_prototype(product, title, concept, spec)
    fw = fx.FRAMEWORK_BY_STAGE["s06"]
    spec_md = fx.to_markdown(STAGE_BY_ID["s06"], fw, spec)
    extra = ""
    if "s09" in drafts:
        extra = fx.to_markdown(STAGE_BY_ID["s09"], fx.FRAMEWORK_BY_STAGE["s09"], drafts["s09"])[:20000]
    prompt = (
        f"プロダクト「{product.name}」の「{title}」の試作を作ります。考え方：{concept}\n"
        "下のプロダクト仕様（ストーリーと画面）を、ブラウザで触れる試作にしてください。\n" + PROTO_RULES
        + "HTML だけを返す（説明やコードブロックの印は付けない）。\n\n"
        f"## プロダクト仕様\n{spec_md[:40000]}\n\n## アプリケーション設計（あれば）\n{extra}\n"
    )
    text = llm._strip_fence(llm._text(conn, conn.chat_model, prompt))
    if "<html" not in text.lower() and "<body" not in text.lower():
        raise AutodevError(502, "AI が HTML を返しませんでした")
    return text


_STUB_CSS = (
    "body{font-family:sans-serif;margin:0;color:#18181b}"
    "header{background:#4f46e5;color:#fff;padding:12px 16px}"
    "nav{display:flex;gap:4px;padding:8px;flex-wrap:wrap;border-bottom:1px solid #e4e4e7}"
    "nav button{border:1px solid #d4d4d8;background:#fff;border-radius:6px;padding:6px 10px}"
    "nav button.on{background:#18181b;color:#fff}main{padding:16px}li{padding:4px 0}"
    "aside{font-size:12px;color:#71717a;padding:0 16px 16px}"
)
_STUB_JS = (
    "const data={};"
    "function show(i){document.querySelectorAll('main section').forEach((s,j)=>s.hidden=j!==i);"
    "document.querySelectorAll('nav button').forEach((b,j)=>b.className=j===i?'on':'');}"
    "function add(ev,i){ev.preventDefault();const inp=ev.target.querySelector('input');"
    "(data[i]=data[i]||[]).push(inp.value);inp.value='';"
    "document.getElementById('l'+i).innerHTML=data[i].map(x=>'<li>'+x.replace(/[<>&]/g,'')+'</li>').join('');}"
    "show(0);"
)


def _stub_prototype(product: Product, title: str, concept: str, spec: dict) -> str:
    """スタブの試作：⑥の画面ごとにタブを作り、各画面で項目を追加できる。"""
    stories = [r for r in (spec.get("stories") or []) if str(r.get("story", "")).strip()]
    screens = [r for r in (spec.get("screens") or []) if str(r.get("name", "") or r.get("screen", "")).strip()]
    names = [str(r.get("name") or r.get("screen")) for r in screens] or ["ホーム", "一覧", "詳細"]
    e = html.escape
    tabs = "".join(f'<button onclick="show({i})">{e(n)}</button>' for i, n in enumerate(names))
    panes = "".join(
        f'<section id="p{i}" hidden><h2>{e(n)}</h2><ul id="l{i}"></ul>'
        f'<form onsubmit="add(event,{i})"><input placeholder="追加する" required><button>追加</button></form>'
        "</section>" for i, n in enumerate(names))
    st = "".join(f"<li>{e(str(r.get('id', '')))} {e(str(r.get('story', '')))}</li>" for r in stories[:12])
    head = ('<!doctype html><html lang="ja"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            f"<title>試作：{e(title)}</title><style>{_STUB_CSS}</style></head>")
    body = (f'<body><header><b>試作：{e(title)}</b><div style="font-size:12px;opacity:.85">'
            f"{e(product.name)} — {e(concept)}</div></header><nav>{tabs}</nav><main>{panes}</main>"
            f"<aside><b>この試作で確かめるストーリー</b><ul>{st}</ul></aside><script>{_STUB_JS}</script></body></html>")
    return head + body


# ---------------- 見る・採用する ----------------
def variant_dict(v: Variant, full: bool = False) -> dict:
    d = {"number": v.number, "key": f"PP-{v.number}", "job_id": v.run_id, "title": v.title, "concept": v.concept,
         "assumptions": v.assumptions or [], "status": v.status, "error": v.error,
         "stages": list((v.drafts or {}).keys()), "has_prototype": bool(v.prototype),
         "adopted_by": v.adopted_by, "adopted_at": v.adopted_at.isoformat() if v.adopted_at else None,
         "created_at": v.created_at.isoformat()}
    if full:
        d["markdown"] = {sid: fx.to_markdown(STAGE_BY_ID[sid], fx.FRAMEWORK_BY_STAGE[sid], dr)
                         for sid, dr in (v.drafts or {}).items()}
    return d


def overview(product: Product) -> dict:
    runs = jobs.history(product.tenant_id, "autodev", product.id, limit=20)
    with session() as s:
        vs = list(s.execute(select(Variant).where(Variant.product_id == product.id)
                            .order_by(Variant.number.desc())).scalars())
    _, now = _upstream(product.id, LAST_STAGE)
    for d in runs:
        d["upstream_changed"] = [sid for sid, ver in (d["params"].get("based_on") or {}).items() if now.get(sid) != ver]
        d["pre_products"] = [variant_dict(v) for v in vs if v.run_id == d["id"]]
    return {"runs": runs}


def _variant(s, product: Product, number: int) -> Variant:
    q = select(Variant).where(Variant.product_id == product.id, Variant.number == number)
    v = s.execute(q).scalar_one_or_none()
    if v is None:
        raise AutodevError(404, f"PP-{number} はありません")
    return v


def variant(product: Product, number: int) -> dict:
    with session() as s:
        v = _variant(s, product, number)
        job_id = v.run_id
    return {**variant_dict(v, True), "job": jobs.run_dict(job_id)}


def prototype_html(product: Product, number: int) -> str:
    with session() as s:
        v = _variant(s, product, number)
        if not v.prototype:
            raise AutodevError(404, "試作がまだありません")
        return v.prototype


def adopt(product: Product, user: str, number: int) -> dict:
    """この案の下書きを本線の各ステージに入れる。人がそこから直して更新・承認する。"""
    with session() as s:
        v = _variant(s, product, number)
        if v.status not in ("ready", "adopted"):
            raise AutodevError(409, "できあがった案だけを採用できます")
        drafts = dict(v.drafts or {})
    changed = {}
    for sid, d in drafts.items():
        fw = fx.FRAMEWORK_BY_STAGE[sid]
        values = {}
        for f in fw.fields:
            if f.key in d:
                try:
                    values[f.key] = fx.coerce(f, d[f.key])
                except (ValueError, TypeError):
                    continue
        changed[sid] = repo.set_fields(product.id, sid, values, user, f"pre-product PP-{number}")
    with session() as s:
        v = _variant(s, product, number)
        v.status, v.adopted_by, v.adopted_at = "adopted", user, dt.datetime.now(dt.UTC)
        s.commit()
    repo.log(product.id, None, "human", user, "autodev.adopt",
             {"pre_product": f"PP-{number}", "stages": {k: len(c) for k, c in changed.items()}})
    return variant(product, number)


jobs.HANDLERS["autodev"] = run
