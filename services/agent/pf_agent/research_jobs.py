"""リサーチライブラリの AI の仕事（ジョブ）：記事への質問と、調査レポート（技術調査・業界調査・公的データ）。

- 質問（kind=research-qa）：AI が元記事を開いて読み、答える。開けなければ（Gemini の接続なら）検索で確かめる。
  答えには「元記事を読んだ／検索で確かめた／確かめられなかった」の印を付ける
- 調査レポート（kind=research-report）：公開資料を（Gemini の接続なら検索で）読み、種類ごとの形にまとめる。
  出典と確認日を付ける。検索が使えない接続では、記事集と AI の知識からまとめたことを印にする
"""

from __future__ import annotations

import datetime as dt

from pydantic import BaseModel
from sqlalchemy import func, select

from . import jobs, llm, llmconf, repo
from .db import JobRun, ResearchArticle, ResearchLibrary, ResearchPlayer, ResearchQuestion, ResearchReport, session
from .research import (
    DEFAULT_LAYERS,
    ResearchError,
    _digest,
    _lib,
    can_search,
    fetch,
    grounded,
    html_text,
    question_dict,
    report_dict,
)

jobs.JOBS["research-qa"] = jobs.JobDef(
    "research-qa",
    "記事への質問",
    "記事に寄せられた質問に、AI が元記事（開けなければ検索）を読んで答える。",
    "リサーチライブラリの記事の「この記事に質問する」",
    10,
)
jobs.JOBS["research-report"] = jobs.JobDef(
    "research-report",
    "調査レポートの作成",
    "技術調査・業界調査・公的データを、公開資料を読んで種類ごとの形にまとめる。出典と確認日を付ける。",
    "リサーチライブラリの「調査レポートを作る」",
    30,
)


def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


# ---------------- 記事への質問 ----------------
class QaAnswer(BaseModel):
    answer: str  # 質問への答え（日本語、3〜6文）
    found: bool  # 答えの根拠が本文にあったか


def ask(tenant: str, user: str, article_number: int, question: str) -> dict:
    question = question.strip()
    if not question:
        raise ResearchError(422, "質問を入れてください")
    with session() as s:
        a = s.execute(
            select(ResearchArticle).where(ResearchArticle.tenant_id == tenant, ResearchArticle.number == article_number)
        ).scalar_one_or_none()
        if a is None:
            raise ResearchError(404, f"RA-{article_number} はありません")
        q = ResearchQuestion(
            tenant_id=tenant, library_id=a.library_id, article_id=a.id, question=question[:500], asked_by=user
        )
        s.add(q)
        s.commit()
        qid = q.id
    return _start_qa(tenant, user, qid, article_number)


def _lib_number(library_id: int) -> int:
    with session() as s:
        return s.get(ResearchLibrary, library_id).number


def _start_qa(tenant: str, user: str, qid: int, article_number: int) -> dict:
    conn = llmconf.resolve(tenant)
    with session() as s:
        lib_id = s.get(ResearchQuestion, qid).library_id
    job_id = jobs.create(
        "research-qa",
        tenant,
        None,
        user,
        {"question": qid, "article": article_number, "number": _lib_number(lib_id)},
        total=2,
        model=conn.summary_model,
        tasks=[
            {"id": "read", "name": "元記事を読む", "deps": []},
            {"id": "answer", "name": "答える", "deps": ["read"]},
        ],
    )
    with session() as s:
        q = s.get(ResearchQuestion, qid)
        q.job_id, q.state, q.message = job_id, "pending", ""
        s.commit()
    jobs.dispatch(job_id)
    with session() as s:
        return question_dict(s.get(ResearchQuestion, qid))


def retry_question(tenant: str, user: str, qid: int) -> dict:
    with session() as s:
        q = s.get(ResearchQuestion, qid)
        if q is None or q.tenant_id != tenant:
            raise ResearchError(404, "質問がありません")
        num = s.get(ResearchArticle, q.article_id).number
    return _start_qa(tenant, user, qid, num)


def delete_question(tenant: str, qid: int) -> None:
    with session() as s:
        q = s.get(ResearchQuestion, qid)
        if q is None or q.tenant_id != tenant:
            raise ResearchError(404, "質問がありません")
        s.delete(q)
        s.commit()


def run_qa(job_id: str) -> None:
    with session() as s:
        j = s.get(JobRun, job_id)
        q = s.get(ResearchQuestion, j.params["question"])
        a = s.get(ResearchArticle, q.article_id)
        q.state = "running"
        s.commit()
        qid, question, tenant = q.id, q.question, q.tenant_id
        url, title, summary = a.url, a.title_ja or a.title, a.summary
    conn = llmconf.resolve(tenant)
    try:
        text = ""
        with jobs.task(job_id, "read"):
            if url.startswith("http"):
                try:
                    _, ctype, page = fetch(url)
                    text = html_text(page)[1] if "html" in ctype or "<html" in page[:500].lower() else page
                except Exception as e:  # noqa: BLE001  開けなければ検索に回す
                    jobs.set_task(job_id, "read", detail=f"開けません：{str(e)[:150]}")
            if len(text) >= 200:
                jobs.set_task(job_id, "read", detail=f"本文 {len(text)}文字")
        with jobs.task(job_id, "answer"):
            sources: list[dict] = []
            if conn.provider == "stub":
                answer, basis = (
                    f"（スタブ）「{question}」への答え。記事「{title}」の要約：{summary[:200]}",
                    ("article" if text else "none"),
                )
            elif len(text) >= 200:
                prompt = (
                    "次の記事の本文だけを根拠に、質問に日本語で答えてください（3〜6文）。"
                    "本文に答えがなければ found を false にし、何が書かれていないかを答えに書く。\n"
                    f"## 質問\n{question}\n## 記事\n{title}\n{url}\n{text[:40000]}"
                )
                r = llm._json(conn, conn.summary_model, prompt, QaAnswer)
                answer, basis = r.answer, "article" if r.found else "none"
            elif can_search(conn):
                answer, sources = grounded(
                    conn,
                    f"次の記事について、質問に日本語で答えてください（3〜6文）。記事：{title}（{url}）\n"
                    f"記事の要約：{summary}\n質問：{question}\n確かめられないことは、確かめられないと書く。",
                )
                basis = "search"
            else:
                prompt = (
                    "元記事を開けませんでした。次の要約だけを根拠に、質問に日本語で答えてください。"
                    "要約から分からないことは分からないと書く。\n"
                    f"## 質問\n{question}\n## 記事\n{title}\n{summary}"
                )
                answer, basis = llm._text(conn, conn.summary_model, prompt).strip(), "none"
            jobs.set_task(
                job_id,
                "answer",
                detail={"article": "元記事を読んで回答", "search": "検索で確認して回答"}.get(
                    basis, "元記事を確認できなかった"
                ),
            )
        with session() as s:
            q = s.get(ResearchQuestion, qid)
            q.state, q.answer, q.basis, q.sources, q.answered_at = "answered", answer, basis, sources[:5], _now()
            s.commit()
    except jobs.Cancelled:
        _q_error(qid, "取り消しました")
        raise
    except Exception as e:
        _q_error(qid, getattr(e, "message", None) or str(e)[:300] or type(e).__name__)
        raise


def _q_error(qid: int, msg: str) -> None:
    with session() as s:
        q = s.get(ResearchQuestion, qid)
        if q is not None:
            q.state, q.message = "error", msg[:500]
            s.commit()


# ---------------- 調査レポート ----------------
KINDS = {"tech": "技術調査", "industry": "業界調査", "public": "公的データ"}


class TechElement(BaseModel):
    code: str  # E1 など短い記号
    name: str
    desc: str


class TechComponent(BaseModel):
    id: str  # 文書の中で一意の短い記号
    name: str
    lane: str  # どこにあるか（利用者側・事業者側・決済側 など）
    desc: str


class TechFlow(BaseModel):
    step: int
    src: str  # TechComponent.id
    dst: str  # TechComponent.id
    label: str


class TechHow(BaseModel):
    code: str  # TechElement.code
    how: str  # この文書がその要素をどう扱っているか


class TechLink(BaseModel):
    to: str  # 別の TechDoc.id
    rel: str  # 使う・つながる など


class TechDoc(BaseModel):
    id: str
    title: str
    org: str
    kind: str  # 規格 | 開発者文書 | 論文 | その他
    summary: str
    urls: list[str]
    components: list[TechComponent]
    flow: list[TechFlow]
    elements: list[TechHow]
    links: list[TechLink]


class TechReport(BaseModel):
    summary: str
    elements: list[TechElement]
    docs: list[TechDoc]


class Ref(BaseModel):
    text: str
    url: str


class Industry(BaseModel):
    name: str
    order: int  # 広がる順（1から）
    size: str  # 規模（数字と時点）
    size_source: str
    flow: list[str]  # 手続き・取引の流れ（順に）
    issues: list[str]  # 課題
    cases: list[Ref]  # 事例
    rules: list[Ref]  # 制度
    barriers: list[str]  # 広がる上での障壁


class IndustryReport(BaseModel):
    summary: str
    industries: list[Industry]


class Point(BaseModel):
    period: str  # 2024 や 2025-Q1 など
    value: float


class Stat(BaseModel):
    title: str
    unit: str
    source: str
    url: str
    series: list[Point]
    note: str


class RuleItem(BaseModel):
    date: str  # YYYY-MM-DD か YYYY-MM
    title: str
    org: str
    body: str
    url: str


class GovItem(BaseModel):
    title: str
    status: str  # 実施済み・進行中・検討中 など
    body: str
    url: str


class PublicReport(BaseModel):
    summary: str
    stats: list[Stat]
    rules: list[RuleItem]
    gov: list[GovItem]


SCHEMAS = {"tech": TechReport, "industry": IndustryReport, "public": PublicReport}
ASK = {
    "tech": "このテーマを支える技術要素（8〜12）と、それを定める規格・各社の開発者文書（5〜10）を読み解いてください。"
    "文書ごとに、構成要素（どこに何があるか）、主な処理の流れ（順番つきの矢印）、扱う技術要素とその扱い方、"
    "ほかの文書とのつながりを挙げてください。",
    "industry": "このテーマが広がる業界を、広がる順に並べ、業界ごとの規模（数字と時点と出典）、手続き・取引の流れ、"
    "課題、事例、関係する制度、障壁を整理してください。",
    "public": "このテーマに関係する公的な統計（年ごとなどの数字の系列）、法令・指針・当局の発言（日付つき）、"
    "行政手続きのデジタル化の状況を、官公庁などの公的な出典からまとめてください。数字と日付は出典から取ってください。",
}


def create_report(tenant: str, user: str, number: int, kind: str, title: str, instructions: str) -> dict:
    if kind not in KINDS:
        raise ResearchError(422, f"種類は {list(KINDS)} のどれか")
    title = title.strip() or KINDS[kind]
    with session() as s:
        lib = _lib(s, tenant, number)
        n = (
            s.execute(select(func.max(ResearchReport.number)).where(ResearchReport.tenant_id == tenant)).scalar() or 0
        ) + 1
        r = ResearchReport(
            tenant_id=tenant,
            library_id=lib.id,
            number=n,
            kind=kind,
            title=title[:300],
            instructions=instructions[:5000],
            created_by=user,
        )
        s.add(r)
        s.commit()
        rid = r.id
    return _start_report(tenant, user, rid)


def _start_report(tenant: str, user: str, rid: int) -> dict:
    conn = llmconf.resolve(tenant)
    with session() as s:
        r0 = s.get(ResearchReport, rid)
        lib_id, kind, title = r0.library_id, r0.kind, r0.title
    job_id = jobs.create(
        "research-report",
        tenant,
        None,
        user,
        {"report": rid, "number": _lib_number(lib_id), "kind": kind, "title": title},
        total=2,
        model=conn.chat_model,
        tasks=[
            {"id": "research", "name": "公開資料を調べる", "deps": []},
            {"id": "structure", "name": "形にまとめる", "deps": ["research"]},
        ],
    )
    with session() as s:
        r = s.get(ResearchReport, rid)
        r.job_id, r.status, r.error = job_id, "queued", ""
        s.commit()
    jobs.dispatch(job_id)
    with session() as s:
        return report_dict(s.get(ResearchReport, rid))


def retry_report(tenant: str, user: str, rid: int) -> dict:
    with session() as s:
        r = s.get(ResearchReport, rid)
        if r is None or r.tenant_id != tenant:
            raise ResearchError(404, "レポートがありません")
    return _start_report(tenant, user, rid)


def delete_report(tenant: str, rid: int) -> None:
    with session() as s:
        r = s.get(ResearchReport, rid)
        if r is None or r.tenant_id != tenant:
            raise ResearchError(404, "レポートがありません")
        s.delete(r)
        s.commit()


def _topic(lib: ResearchLibrary, title: str, instr: str) -> str:
    return f"テーマ：{lib.name}（{lib.description}）\nレポート：{title}\n" + (f"指示：{instr}\n" if instr else "")


def report_research(conn, lib: ResearchLibrary, kind: str, title: str, instr: str) -> tuple[str, list, str]:
    """調査レポートの下調べ：検索が使える接続なら Web 検索で公開資料を読む。返り値は（メモ, 出典, 根拠の種類）。"""
    if conn.provider == "stub":
        return "", [], "stub"
    if not can_search(conn):
        return "", [], "knowledge"
    notes, sources = grounded(
        conn, f"{_topic(lib, title, instr)}\n{ASK[kind]}\n出典の URL と確認できた日付を本文に残してください。"
    )
    return notes, sources[:40], "search"


def report_structure(
    conn, lib: ResearchLibrary, arts: list, kind: str, title: str, instr: str, notes: str, basis: str
) -> dict:
    """下調べのメモと記事集を根拠に、種類ごとの形にまとめる。"""
    if basis == "stub":
        return _stub_report(kind, title)
    prompt = (
        f"{_topic(lib, title, instr)}\n{ASK[kind]}\n下の調査メモと記事集の要約を根拠に、項目を日本語で埋めてください。"
        "根拠にないことは書かない。数字・日付・URL は根拠から写す。\n\n"
        f"## 調査メモ\n{notes or '（なし）'}\n\n## 記事集\n{_digest(arts, 80)}"
    )
    return llm._json(conn, conn.chat_model, prompt, SCHEMAS[kind]).model_dump()


BASIS_NOTE = {"knowledge": "検索が使えない接続のため、記事集と AI の知識から", "stub": "スタブ"}


def run_report(job_id: str) -> None:
    with session() as s:
        j = s.get(JobRun, job_id)
        r = s.get(ResearchReport, j.params["report"])
        lib = s.get(ResearchLibrary, r.library_id)
        r.status = "running"
        s.commit()
        rid, kind, title, instr, tenant = r.id, r.kind, r.title, r.instructions, r.tenant_id
        arts = list(s.execute(select(ResearchArticle).where(ResearchArticle.library_id == lib.id)).scalars())
        s.expunge(lib)
    conn = llmconf.resolve(tenant)
    try:
        with jobs.task(job_id, "research"):
            notes, sources, basis = report_research(conn, lib, kind, title, instr)
            jobs.set_task(job_id, "research", detail=f"出典 {len(sources)}件" if sources else BASIS_NOTE.get(basis, ""))
        with jobs.task(job_id, "structure"):
            data = report_structure(conn, lib, arts, kind, title, instr, notes, basis)
            jobs.set_task(job_id, "structure", detail=data.get("summary", "")[:120])
        _save_report(rid, data, sources, basis)
        repo.log(
            None,
            None,
            "agent",
            f"research-report ({conn.chat_model})",
            "research.report",
            {"report": rid, "kind": kind},
            tenant_id=tenant,
        )
    except jobs.Cancelled:
        _r_error(rid, "取り消しました")
        raise
    except Exception as e:
        _r_error(rid, getattr(e, "message", None) or str(e)[:300] or type(e).__name__)
        raise


def _save_report(rid: int, data: dict, sources: list, basis: str) -> None:
    with session() as s:
        r = s.get(ResearchReport, rid)
        r.status, r.data, r.sources, r.basis, r.error = "done", data, sources, basis, ""
        r.checked = dt.date.today().isoformat()
        s.commit()


def refresh_report(conn, tenant: str, user: str, lib_id: int, kind: str) -> dict:
    """ライブラリの更新から：その種類のいちばん新しいレポートを作り直す（なければ作る）。"""
    with session() as s:
        lib = s.get(ResearchLibrary, lib_id)
        r = (
            s.execute(
                select(ResearchReport)
                .where(ResearchReport.library_id == lib_id, ResearchReport.kind == kind)
                .order_by(ResearchReport.number.desc())
            )
            .scalars()
            .first()
        )
        if r is None:
            n = (
                s.execute(select(func.max(ResearchReport.number)).where(ResearchReport.tenant_id == tenant)).scalar()
                or 0
            ) + 1
            r = ResearchReport(
                tenant_id=tenant, library_id=lib_id, number=n, kind=kind, title=KINDS[kind], created_by=user
            )
            s.add(r)
        r.status, r.error = "running", ""
        s.commit()
        rid, title, instr = r.id, r.title, r.instructions
        arts = list(s.execute(select(ResearchArticle).where(ResearchArticle.library_id == lib_id)).scalars())
        s.expunge(lib)
    try:
        notes, sources, basis = report_research(conn, lib, kind, title, instr)
        data = report_structure(conn, lib, arts, kind, title, instr, notes, basis)
    except Exception as e:
        _r_error(rid, getattr(e, "message", None) or str(e)[:300] or type(e).__name__)
        raise
    _save_report(rid, data, sources, basis)
    with session() as s:
        return report_dict(s.get(ResearchReport, rid))


# ---------------- プレーヤーを調べる ----------------
class ExPlayer(BaseModel):
    name: str
    aliases: list[str]  # 記事の中での呼び方（略称・英語名など）
    layer: str  # ライブラリの層から1つ
    region: str  # ISO 2文字
    role: str  # 役割（1行）
    detail: str  # このテーマでの取り組み（2〜3文）
    stance: str  # 推進・様子見・慎重・拒否 など
    tags: list[str]  # 対応する規格・製品


class ExPlayers(BaseModel):
    players: list[ExPlayer]


def research_players(conn, tenant: str, user: str, number: int) -> tuple[int, int]:
    """テーマの主要なプレーヤーを、層・役割・姿勢・対応規格つきで調べて足す（既にあれば空の項目を埋める）。
    検索が使える接続なら Web 検索、そうでなければ記事集から。"""
    with session() as s:
        lib = _lib(s, tenant, number)
        layers = lib.layers or DEFAULT_LAYERS
        have = {
            p.name: p.id for p in s.execute(select(ResearchPlayer).where(ResearchPlayer.library_id == lib.id)).scalars()
        }
        arts = list(s.execute(select(ResearchArticle).where(ResearchArticle.library_id == lib.id)).scalars())
        lib_id, name, desc, entities = lib.id, lib.name, lib.description, list(lib.entities or [])
    if conn.provider == "stub":
        from collections import Counter

        cnt = Counter(e for a in arts for e in (a.entities or []))
        found = [
            ExPlayer(name=e, aliases=[], layer=layers[0], region="", role="", detail="", stance="", tags=[])
            for e, _ in cnt.most_common(20)
        ]
        found += [
            ExPlayer(name=e, aliases=[], layer=layers[0], region="", role="", detail="", stance="", tags=[])
            for e in entities
            if e not in cnt
        ]
    else:
        notes = ""
        ask = (
            f"テーマ「{name}」（{desc}）の主要なプレーヤー（企業・団体・規格団体・当局・調査会社など）を、"
            f"次の層ごとに挙げてください：{'、'.join(layers)}。それぞれ、役割、このテーマでの取り組み、"
            "姿勢（推進・様子見・慎重・拒否など）、対応する規格や製品、本拠の国を書いてください。最大40社。"
            + (f"必ず含める企業・団体：{'、'.join(entities)}。" if entities else "")
        )
        if can_search(conn):
            notes, _ = grounded(conn, ask)
        prompt = (
            ask + "\n下の調査メモと記事集を根拠に、項目を日本語で埋めてください。layer は上の層のどれか。"
            "根拠にないことは書かない（分からない項目は空）。\n\n"
            f"## 調査メモ\n{notes or '（なし）'}\n\n## 記事集\n{_digest(arts, 120)}\n\n"
            f"## 登録済みのプレーヤー\n{'、'.join(have) or '（なし）'}"
        )
        found = llm._json(conn, conn.summary_model, prompt, ExPlayers).players
    added = filled = 0
    with session() as s:
        cur = {
            p.name: p for p in s.execute(select(ResearchPlayer).where(ResearchPlayer.library_id == lib_id)).scalars()
        }
        alias = {a: p for p in cur.values() for a in (p.aliases or [])}
        for x in found[:60]:
            nm = x.name.strip()
            if not nm:
                continue
            p = cur.get(nm) or alias.get(nm)
            layer = x.layer if x.layer in layers else layers[-1]
            if p is None:
                p = ResearchPlayer(
                    tenant_id=tenant,
                    library_id=lib_id,
                    name=nm[:200],
                    aliases=x.aliases[:20],
                    layer=layer,
                    region=x.region[:8],
                    role=x.role[:300],
                    detail=x.detail[:5000],
                    stance=x.stance[:100],
                    tags=x.tags[:20],
                    updated_by=f"ai ({user})",
                )
                s.add(p)
                cur[nm] = p
                added += 1
                continue
            changed = False
            for k, v, n in (
                ("layer", layer, 100),
                ("region", x.region, 8),
                ("role", x.role, 300),
                ("detail", x.detail, 5000),
                ("stance", x.stance, 100),
            ):
                if v and not getattr(p, k):
                    setattr(p, k, v[:n])
                    changed = True
            for k, v in (("aliases", x.aliases), ("tags", x.tags)):
                more = [t for t in v if t not in (getattr(p, k) or [])]
                if more:
                    setattr(p, k, [*(getattr(p, k) or []), *more][:20])
                    changed = True
            filled += 1 if changed else 0
        s.commit()
    return added, filled


def _r_error(rid: int, msg: str) -> None:
    with session() as s:
        r = s.get(ResearchReport, rid)
        if r is not None:
            r.status, r.error = "failed", msg[:500]
            s.commit()


def _stub_report(kind: str, title: str) -> dict:
    if kind == "tech":
        return TechReport(
            summary=f"{title}（スタブ）",
            elements=[
                TechElement(code="E1", name="認証", desc="利用者を確かめる"),
                TechElement(code="E2", name="支払い", desc="代金を払う"),
            ],
            docs=[
                TechDoc(
                    id="d1",
                    title="サンプル規格",
                    org="標準化団体",
                    kind="規格",
                    summary="見本の文書。",
                    urls=["https://example.com/spec"],
                    components=[
                        TechComponent(id="u", name="利用者", lane="利用者側", desc=""),
                        TechComponent(id="s", name="事業者", lane="事業者側", desc=""),
                    ],
                    flow=[
                        TechFlow(step=1, src="u", dst="s", label="注文する"),
                        TechFlow(step=2, src="s", dst="u", label="確認を返す"),
                    ],
                    elements=[TechHow(code="E1", how="トークンで確かめる")],
                    links=[],
                )
            ],
        ).model_dump()
    if kind == "industry":
        return IndustryReport(
            summary=f"{title}（スタブ）",
            industries=[
                Industry(
                    name="小売",
                    order=1,
                    size="100億円（2025年）",
                    size_source="見本",
                    flow=["探す", "選ぶ", "払う"],
                    issues=["見本の課題"],
                    cases=[Ref(text="見本の事例", url="https://example.com")],
                    rules=[],
                    barriers=["見本の障壁"],
                )
            ],
        ).model_dump()
    return PublicReport(
        summary=f"{title}（スタブ）",
        stats=[
            Stat(
                title="見本の統計",
                unit="億円",
                source="見本の省庁",
                url="https://example.com",
                series=[Point(period="2023", value=10), Point(period="2024", value=12), Point(period="2025", value=15)],
                note="",
            )
        ],
        rules=[
            RuleItem(date="2025-04", title="見本の指針", org="見本の省庁", body="見本。", url="https://example.com")
        ],
        gov=[GovItem(title="見本の手続き", status="進行中", body="見本。", url="https://example.com")],
    ).model_dump()


jobs.HANDLERS["research-qa"] = run_qa
jobs.HANDLERS["research-report"] = run_report
