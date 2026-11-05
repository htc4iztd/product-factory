"""エージェントのツール：固定のロジックで動かすべきところをコードにしたもの。スキルが名前で呼ぶ。

- 読むツール（read）：AI が必要なときに呼べる（1回の実行で回数の上限つき）。スキルの prefetch に書いたものは、
  AI を呼ぶ前にコードが実行して材料にする
- 書くツール（write）：AI は最後の出力に「何をしたいか」を入れるだけで、コードが検証してから実行する
  （項目の型・宛先・権限・数の上限）。実行は team._apply・pms・platform_agent が受け持つ

エージェントが使えるツール ＝ 割り当て（personas.profile の tools）にあり、かつ読み込んだスキルが使うと宣言したもの。
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field

from pydantic import BaseModel, Field

from . import fwlib
from .db import Product


class ToolError(Exception):
    pass


@dataclass
class Ctx:
    product: Product | None
    key: str  # エージェントの key（pm_biz・s01・platform など）
    tenant: str
    read_log: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class Tool:
    name: str
    label: str
    kind: str  # read | write
    description: str
    params: type[BaseModel] | None = None
    run: Callable[[Ctx, BaseModel], str] | None = None
    roles: tuple[str, ...] = ("stage", "pm", "platform")  # 割り当てられる役割
    section: str = ""  # 書くツール：最後の出力のどの欄に入るか

    def schema(self) -> dict:
        js = (self.params or _NoArgs).model_json_schema()
        js.pop("title", None)
        return js


class _NoArgs(BaseModel):
    pass


def _role(key: str) -> str:
    from .team import PMS

    return "pm" if key in PMS else "platform" if key == "platform" else "stage"


def _need_product(ctx: Ctx) -> Product:
    if ctx.product is None:
        raise ToolError("このツールはプロダクトの中でだけ使えます")
    return ctx.product


def _stage(ctx: Ctx, stage_id: str) -> str:
    from .stages import STAGE_BY_ID

    sid = stage_id or (ctx.key if ctx.key in STAGE_BY_ID else "")
    if sid not in STAGE_BY_ID:
        raise ToolError(f"工程 {stage_id or '（未指定）'} はありません（s01〜s14）")
    return sid


# ---------------- 読むツール ----------------
class StageArg(BaseModel):
    stage_id: str = Field(default="", description="工程の id（s01〜s14）。空なら自分の工程")


class QueryArg(BaseModel):
    query: str = Field(description="探す言葉（項目名・用語・固有名詞など）")


class IssueArg(BaseModel):
    number: int = Field(description="Issue の番号（#n の n）")


class IssuesArg(BaseModel):
    scope: str = Field(default="mine", description="mine（自分宛て）| sent（自分が起票）| open（終わっていない全部）")


class CodeReadArg(BaseModel):
    paths: list[str] = Field(description="読むファイルのパス（作業場の中。5つまで）", max_length=5)


def _code_tree(ctx: Ctx, _a: BaseModel) -> str:
    from . import workspace as ws

    p = _need_product(ctx)
    files = [e for e in ws.tree(p.id)["entries"] if e["type"] == "file"]
    if not files:
        return "作業場にはまだファイルがありません（⑨のユニット分割に沿って、最初のユニットから作る）"
    hist = ws.history(p.id, 10)
    return ("## 作業場のファイル\n" + "\n".join(f"- {e['path']}（{e['size']}B）" for e in files[:400])
            + ("\n（ほか省略）" if len(files) > 400 else "")
            + "\n\n## 最近の変更\n" + "\n".join(
                f"- #{c['number']} [{c['unit'] or '-'}] {c['message'][:80]}（{c['author']}）" for c in hist))


def _code_read(ctx: Ctx, a: CodeReadArg) -> str:
    from . import workspace as ws

    p = _need_product(ctx)
    out = []
    for path in a.paths[:5]:
        try:
            body = ws.read(p.id, path)
            more = "\n（長いので途中まで）" if len(body) > 30000 else ""
            out.append(f"### {path}\n```\n{body[:30000]}\n```{more}")
        except ws.WorkspaceError as e:
            out.append(f"### {path}\nエラー：{e.message}")
    return "\n\n".join(out)


def _stage_draft(ctx: Ctx, a: StageArg) -> str:
    from . import frameworks as fx
    from . import repo
    from .stages import STAGE_BY_ID

    p, sid = _need_product(ctx), _stage(ctx, a.stage_id)
    fw = fwlib.of(p.id, sid)
    d = repo.draft(p.id, sid)
    miss = fx.check(fw, d)
    rs = repo.runs(p.id)[sid]
    return (
        f"# {STAGE_BY_ID[sid].no}{STAGE_BY_ID[sid].name}（状態：{rs.status}、版 v{rs.current_version}）\n"
        + (f"必須が空：{'、'.join(miss)}\n" if miss else "必須はすべて埋まっています\n")
        + fx.to_markdown(STAGE_BY_ID[sid], fw, d)[:20000]
    )


def _stage_fields(ctx: Ctx, a: StageArg) -> str:
    from . import frameworks as fx
    from . import llm

    sid = _stage(ctx, a.stage_id)
    fw = fwlib.of(ctx.product.id if ctx.product else None, sid)
    return (
        f"{fw.title}：{fw.summary}\n" + json.dumps(fx.spec(fw), ensure_ascii=False)[:8000] + "\n" + llm.value_rules(fw)
    )


def _upstream(ctx: Ctx, a: StageArg) -> str:
    from . import repo
    from .stages import STAGE_BY_ID, STAGES

    p, sid = _need_product(ctx), _stage(ctx, a.stage_id)
    st = STAGE_BY_ID[sid]
    ups = repo.confirmed_artifacts(p.id, st.inputs)
    down = "、".join(f"{x.id}={x.no}{x.name}" for x in STAGES if sid in x.inputs)
    parts = [f"## {k}（確定版）\n{v[:6000]}" for k, v in ups.items()]
    # 確定していない上流は、今の下書きを読む（確定を待たずに進められるように。読む権限の制限はない）
    for u in st.inputs:
        if not any(k.startswith(u) or STAGE_BY_ID[u].name in k for k in ups):
            parts.append(f"## {u}（未確定の下書き）\n{_stage_draft(ctx, StageArg(stage_id=u))[:6000]}")
    body = "\n\n".join(parts) or "（上流はありません）"
    return f"上流：{'、'.join(st.inputs) or 'なし'}／下流：{down or 'なし'}\n\n{body}"


def _docs_read(ctx: Ctx, a: StageArg) -> str:
    from .imports import docs_context

    p = _need_product(ctx)
    return docs_context(p.id, ctx.key) or "（読んでいいと割り当てられた資料・ドキュメントはありません）"


def _docs_search(ctx: Ctx, a: QueryArg) -> str:
    from sqlalchemy import select

    from .collab import readable_docs
    from .db import ImportDoc, session
    from .imports import _sections, readers_of

    p = _need_product(ctx)
    q = a.query.strip()
    if not q:
        raise ToolError("探す言葉が空です")
    with session() as s:
        docs = [
            (f"資料{d.id}「{d.filename}」", d.text or "")
            for d in s.execute(
                select(ImportDoc).where(ImportDoc.product_id == p.id, ImportDoc.status == "done").limit(30)
            ).scalars()
            if ctx.key in readers_of(d)
        ]
    docs += [(head, body) for head, body, _ in readable_docs(p.id, ctx.key, 30)]
    hits = []
    for name, text in docs:
        for h, body in _sections(text):
            n = (h + body).count(q)
            if n:
                hits.append((n, f"### {name}" + (f"— {h}" if h else "") + f"\n{body.strip()[:2500]}"))
    hits.sort(key=lambda x: -x[0])
    return "\n\n".join(h for _, h in hits[:5]) or f"「{q}」を含む箇所は、読める資料にありません"


def _issue_read(ctx: Ctx, a: IssueArg) -> str:
    from . import issues as iss

    p = _need_product(ctx)
    try:
        i = iss.get(p, a.number)
    except iss.IssueError as e:
        raise ToolError(e.message) from None
    j = "\n".join(
        f"- {x['created_at'][:16]} {x['author_name']}：{x['notes'][:600]}" for x in i["journals"] if x["notes"]
    )
    return (
        f"#{i['number']}［{i['tracker_label']}・{i['status_label']}・{i['priority']}・{i['done_ratio']}%］{i['subject']}\n"
        f"起票：{i['author_name']}／担当：{i['assignee_name']}\n{i['description'][:3000]}\n{j}"
    )


def _issues_list(ctx: Ctx, a: IssuesArg) -> str:
    from sqlalchemy import select

    from .db import AgentIssue, session
    from .team import KEYS, OPEN, name_of

    p = _need_product(ctx)
    q = select(AgentIssue).where(AgentIssue.product_id == p.id, AgentIssue.status.in_(OPEN))
    if a.scope == "mine":
        q = q.where(AgentIssue.assignee == ctx.key)
    elif a.scope == "sent":
        q = q.where(AgentIssue.author == ctx.key)
    with session() as s:
        rows = list(s.execute(q.order_by(AgentIssue.number).limit(60)).scalars())
        return (
            "\n".join(
                f"- #{i.number}［{i.status}・{i.priority}］{i.subject}"
                f"（{name_of(i.author) if i.author in KEYS else 'PdM'}→{name_of(i.assignee)}）"
                for i in rows
            )
            or "（ありません）"
        )


def _board_read(ctx: Ctx, a: _NoArgs) -> str:
    from .db import session
    from .team import INTENT_LABEL, _context_posts, _iso, name_of

    p = _need_product(ctx)
    with session() as s:
        posts = _context_posts(s, p.id, ctx.key)
        return (
            "\n".join(
                f"[{x.thread}] {_iso(x.created_at)[:16]} {name_of(x.sender)}→{name_of(x.recipient)}"
                f"（{INTENT_LABEL.get(x.intent, x.intent)}）：{x.text[:600]}"
                for x in posts
            )
            or "（ありません）"
        )


def _trace(ctx: Ctx, a: StageArg) -> str:
    from . import repo
    from .engine import Engine

    p, sid = _need_product(ctx), _stage(ctx, a.stage_id)
    t = Engine._trace(object.__new__(Engine), p, sid, repo.draft(p.id, sid))
    if t is None:
        return "この工程には ID でつないだ網羅の確認はありません（⑥・⑧・⑬にあります）"
    if t["kind"] == "stories_without_ac":
        return f"受入基準のないストーリー：{t['total']} 件中 {len(t['items'])} 件 " + "、".join(
            x["id"] for x in t["items"]
        )
    if t["kind"] == "story_coverage":
        miss = [x["id"] for x in t["items"] if not x["by"]]
        return f"機能要求で覆われていない⑥のストーリー：{t['total']} 件中 {len(miss)} 件 " + "、".join(miss)
    return f"⑬で結果のない受入基準：{len(t['missing'])} 件 " + "、".join(t["missing"]) + f"／結果の内訳 {t['counts']}"


def _crud(ctx: Ctx, a: _NoArgs) -> str:
    from . import designs, repo

    p = _need_product(ctx)
    d = repo.draft(p.id, "s09")
    m = designs.crud_matrix(d.get("specs") or [], d.get("data_model"))
    return json.dumps(m, ensure_ascii=False)[:8000]


def _factory_status(ctx: Ctx, a: _NoArgs) -> str:
    from . import platform_agent as pa

    st = pa.status(ctx.tenant, product_id=ctx.product.id if ctx.product else None)
    return json.dumps(
        {k: st[k] for k in ("scheduler", "jobs", "running", "products")}, ensure_ascii=False, default=str
    )[:12000]


def _findings(ctx: Ctx, a: _NoArgs) -> str:
    from . import platform_agent as pa

    fs = pa.findings(ctx.tenant, include_resolved=10, product_id=ctx.product.id if ctx.product else None)
    return (
        "\n".join(
            f"- {f['id']}［{f['severity']}・{f['status']}］{f['title']}｜{f['detail'][:300]}｜{f['suggestion'][:200]}"
            for f in fs
        )
        or "（問題はありません）"
    )


R = ("stage", "pm", "platform")
TOOLS: dict[str, Tool] = {
    t.name: t
    for t in (
        Tool(
            "stage_draft",
            "工程の下書きを読む",
            "read",
            "工程の今の下書き（項目ごとの値）と、空の必須項目を読む。stage_id に s01〜s14 を入れれば、"
            "どの工程でも読める"
            "（読む権限の制限はない。空の項目は、まだ書かれていないだけ）",
            StageArg,
            _stage_draft,
            ("stage", "pm"),
        ),
        Tool(
            "stage_fields",
            "工程の項目の定義を読む",
            "read",
            "工程の項目（key・型・列・説明）と値の書き方の決まりを読む。書き込む前に確かめる",
            StageArg,
            _stage_fields,
            ("stage", "pm"),
        ),
        Tool(
            "upstream",
            "上流を読む",
            "read",
            "工程の上流（入力になる工程）と下流の工程の一覧を読む。上流が確定していなければ今の下書きを読む",
            StageArg,
            _upstream,
            ("stage", "pm"),
        ),
        Tool(
            "docs_read",
            "資料・ドキュメントを読む",
            "read",
            "読んでいいと割り当てられた取り込み資料と手書きのドキュメント（DOC-n）のうち、自分の工程に関係する章を読む",
            StageArg,
            _docs_read,
            ("stage", "pm"),
        ),
        Tool(
            "docs_search",
            "資料・ドキュメントを探す",
            "read",
            "読んでいいと割り当てられた取り込み資料と手書きのドキュメント（DOC-n）から、言葉を含む章を探して読む",
            QueryArg,
            _docs_search,
            ("stage", "pm"),
        ),
        Tool(
            "issue_read",
            "Issue を読む",
            "read",
            "Issue の内容と、これまでの記録（注記）を読む",
            IssueArg,
            _issue_read,
            ("stage", "pm"),
        ),
        Tool(
            "issues_list",
            "Issue の一覧を読む",
            "read",
            "終わっていない Issue の一覧（自分宛て・自分が起票・全部）",
            IssuesArg,
            _issues_list,
            ("stage", "pm"),
        ),
        Tool(
            "board_read",
            "掲示板を読む",
            "read",
            "自分宛て・自分の投稿・全員宛ての掲示板（古い順）",
            None,
            _board_read,
            ("stage", "pm"),
        ),
        Tool(
            "trace",
            "網羅を確かめる",
            "read",
            "ID でつないだ網羅（⑥ストーリー↔受入基準、⑥ストーリー↔⑧機能要求、⑥受入基準↔⑬結果）を計算する",
            StageArg,
            _trace,
            ("stage", "pm"),
        ),
        Tool(
            "crud_matrix",
            "CRUD マトリクスを作る",
            "read",
            "⑨の処理仕様と概念データモデルから、処理×テーブルの CRUD を計算する",
            None,
            _crud,
            ("stage", "pm"),
        ),
        Tool(
            "factory_status",
            "ファクトリーの稼働状況を読む",
            "read",
            "定期実行・ジョブ（24時間）・プロダクトごとのエージェントの状況",
            None,
            _factory_status,
            ("platform",),
        ),
        Tool(
            "findings", "稼働の問題を読む", "read", "見つかっている稼働の問題と対処の案", None, _findings, ("platform",)
        ),
        Tool("code_tree", "作業場のファイルを見る", "read",
             "開発の作業場（このプロダクトのコード）のファイルの一覧と、最近の変更", None, _code_tree, ("stage", "pm")),
        Tool("code_read", "作業場のファイルを読む", "read", "開発の作業場のファイルの中身を読む（5つまで）",
             CodeReadArg, _code_read, ("stage", "pm")),
        # 書くツール：AI は最後の出力に入れ、コードが検証してから実行する
        Tool(
            "set_field",
            "工程の項目に書き込む",
            "write",
            "自分の工程の項目に値を書き込む（型と項目を検証してから入れる。変えた項目は Issue と監査ログに残る）",
            roles=("stage",),
            section="changes",
        ),
        Tool(
            "issue_update",
            "Issue を更新する",
            "write",
            "Issue に結果・状態・進捗率を書き、返す相手を決める（PdM は宛先にできない）",
            roles=("stage", "pm"),
            section="issue_updates",
        ),
        Tool(
            "issue_create",
            "Issue を起票する",
            "write",
            "他のエージェントに動いてもらうことを起票する（宛先は PM と各工程の担当）",
            roles=("stage", "pm"),
            section="new_issues",
        ),
        Tool(
            "board_post",
            "掲示板に書く",
            "write",
            "他のエージェントへの確認・回答・共有を掲示板に書く",
            roles=("stage", "pm"),
            section="posts",
        ),
        Tool(
            "code_write",
            "作業場にコードを書く",
            "write",
            "開発の作業場にファイルを書く・消す"
            "（ユニットと説明を付け、変更の記録と差分が残る。GitHub がつながっていれば写す）",
            roles=("stage",),
            section="code",
        ),
        Tool(
            "pm_note",
            "PM の記録に残す",
            "write",
            "状況・リスク・決めたことを PM のタスク管理の場所に残す",
            roles=("pm",),
            section="notes",
        ),
        Tool(
            "propose_fix",
            "対処と修正を提案する",
            "write",
            "運用の対処と処理系（コード）の修正案を PdM に出す（実行は PdM の承認、コードは提案だけ）",
            roles=("platform",),
            section="proposals",
        ),
    )
}
READ = tuple(k for k, t in TOOLS.items() if t.kind == "read")
WRITE = tuple(k for k, t in TOOLS.items() if t.kind == "write")


def catalog() -> list[dict]:
    return [
        {
            "name": t.name,
            "label": t.label,
            "kind": t.kind,
            "description": t.description,
            "roles": list(t.roles),
            "params": t.schema() if t.kind == "read" else None,
        }
        for t in TOOLS.values()
    ]


def allowed_for(key: str, names: list[str]) -> list[str]:
    role = _role(key)
    return [n for n in names if n in TOOLS and role in TOOLS[n].roles]


def call(ctx: Ctx, name: str, args: dict | None) -> str:
    """読むツールを実行する（AI の呼び出し・スキルの prefetch）。失敗は文字で返し、AI が言い直せるようにする。"""
    t = TOOLS.get(name)
    if t is None or t.kind != "read" or t.run is None:
        return f"エラー：読むツール {name} はありません"
    try:
        a = (t.params or _NoArgs).model_validate(args or {})
        out = t.run(ctx, a)
    except ToolError as e:
        out = f"エラー：{e}"
    except Exception as e:  # noqa: BLE001  引数の誤りなどは AI に返して言い直させる
        out = f"エラー：{type(e).__name__}：{str(e)[:300]}"
    ctx.read_log.append(f"{name}({json.dumps(args or {}, ensure_ascii=False)})")
    return out[:30000]
