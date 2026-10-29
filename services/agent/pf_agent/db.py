"""工場DB（設計書 6.1）。状態の正本はここに置く。"""
from __future__ import annotations

import datetime as dt
import os
import uuid

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    create_engine,
    inspect,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def _id() -> str:
    return uuid.uuid4().hex


class Base(DeclarativeBase):
    pass


class Product(Base):
    __tablename__ = "products"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(200))
    idea: Mapped[str] = mapped_column(Text, default="")
    scope: Mapped[str] = mapped_column(String(10), default="mvp")      # mvp | poc
    mode: Mapped[str] = mapped_column(String(12), default="personal")  # personal | corporate
    status: Mapped[str] = mapped_column(String(16), default="active")  # active | stopped
    cover_image_id: Mapped[str | None] = mapped_column(String(32), nullable=True)  # プロダクト・キャンバスの表紙
    repo: Mapped[str | None] = mapped_column(String(200), nullable=True)          # GitHub の owner/name
    repo_branch: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # GitHub Issues との同期：off | build（⑫⑬のチケット）| all。import は GitHub で作られた Issue をチケットにするか
    gh_sync: Mapped[str] = mapped_column(String(8), default="off")
    gh_import: Mapped[bool] = mapped_column(Boolean, default=False)
    gh_synced_at: Mapped[str | None] = mapped_column(String(30), nullable=True)   # 最後に取り込んだ時刻
    created_by: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)


class StageRun(Base):
    __tablename__ = "stage_runs"
    __table_args__ = (UniqueConstraint("product_id", "stage_id"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id"), index=True)
    stage_id: Mapped[str] = mapped_column(String(8))
    status: Mapped[str] = mapped_column(String(24), default="not_started")
    session_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    pending: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    answers: Mapped[str | None] = mapped_column(Text, nullable=True)
    audit_retries: Mapped[int] = mapped_column(Integer, default=0)
    audit_findings: Mapped[list | None] = mapped_column(JSON, nullable=True)
    current_version: Mapped[int] = mapped_column(Integer, default=0)
    approved_version: Mapped[int] = mapped_column(Integer, default=0)   # 最新版（更新済みの最新の版）
    # 作業中の下書き（フレームワークの項目ごとの値）。更新すると Artifact の版になる
    draft: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # プロダクトごとの設定：このステージを使うか、更新に承認が要るか
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    approval_required: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class Artifact(Base):
    __tablename__ = "artifacts"
    __table_args__ = (UniqueConstraint("product_id", "stage_id", "version"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id"), index=True)
    stage_id: Mapped[str] = mapped_column(String(8))
    version: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)              # data を Markdown にしたもの（下流・監査用）
    data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    sha256: Mapped[str] = mapped_column(String(64))
    approved: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)


class PhaseReview(Base):
    __tablename__ = "phase_reviews"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id"), index=True)
    phase_id: Mapped[str] = mapped_column(String(4))
    decision: Mapped[str] = mapped_column(String(16))   # proceed | back | stop
    reason: Mapped[str] = mapped_column(Text, default="")
    actor: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ProductImage(Base):
    """プロダクト・キャンバスの画像。画像生成AIの出力を、使ったプロンプトと一緒に残す。"""
    __tablename__ = "product_images"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id"), index=True)
    kind: Mapped[str] = mapped_column(String(16))           # free | graphic | concept | scene | ui
    base_id: Mapped[str | None] = mapped_column(String(32), nullable=True)  # 直した元の画像
    note: Mapped[str] = mapped_column(Text, default="")
    prompt: Mapped[str] = mapped_column(Text)
    model: Mapped[str] = mapped_column(String(80))
    mime: Mapped[str] = mapped_column(String(40))
    data: Mapped[bytes] = mapped_column(LargeBinary)
    created_by: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ChatSession(Base):
    """ステージの対話のまとまり。論点ごとに分けて始め直せる。ADK のセッションと1対1。"""
    __tablename__ = "chat_sessions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id"), index=True)
    stage_id: Mapped[str] = mapped_column(String(8))
    title: Mapped[str] = mapped_column(String(200))
    adk_session_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_by: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)


class StageReport(Base):
    """ステージの対話をまとめたレポート。作るたびに1行増やし、最新を表示する。"""
    __tablename__ = "stage_reports"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id"), index=True)
    stage_id: Mapped[str] = mapped_column(String(8))
    content: Mapped[str] = mapped_column(Text)
    last_message_id: Mapped[int] = mapped_column(Integer, default=0)   # どの発言までを要約したか
    model: Mapped[str] = mapped_column(String(80))
    created_by: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ChatMessage(Base):
    """ステージごとのAIとの対話。assistant の発言には項目の書き換え案（proposals）が付く。"""
    __tablename__ = "chat_messages"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id"), index=True)
    stage_id: Mapped[str] = mapped_column(String(8))
    session_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    role: Mapped[str] = mapped_column(String(12))       # user | assistant | feedback
    actor: Mapped[str] = mapped_column(String(200))
    text: Mapped[str] = mapped_column(Text, default="")
    # [{"id", "field", "value", "reason", "status": pending|accepted|rejected}]
    proposals: Mapped[list | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)


# ---------------- チーム（チケット・議論・決定記録・会議・ドキュメント） ----------------
# 番号はプロダクトの中で振る（TK-1, DEC-1, MTG-1, DOC-1）。成果物の ID（US-01 など）と同じ書き方で参照できる。
class Ticket(Base):
    __tablename__ = "tickets"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[str] = mapped_column(String(32), index=True)
    number: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="todo")    # triage | todo | doing | review | done | closed
    priority: Mapped[str] = mapped_column(String(8), default="P2")     # P1 | P2 | P3
    assignee: Mapped[str | None] = mapped_column(String(200), nullable=True)
    stage_id: Mapped[str | None] = mapped_column(String(8), nullable=True)
    refs: Mapped[list | None] = mapped_column(JSON, nullable=True)      # ["US-03", "DEC-2"]
    due: Mapped[str | None] = mapped_column(String(10), nullable=True)  # YYYY-MM-DD
    source: Mapped[dict | None] = mapped_column(JSON, nullable=True)    # どこから起きたか {kind, id, url}
    external: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # GitHub Issue などとの対応
    created_by: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class Channel(Base):
    __tablename__ = "channels"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    product_id: Mapped[str] = mapped_column(String(32), index=True)
    name: Mapped[str] = mapped_column(String(80))
    topic: Mapped[str] = mapped_column(String(300), default="")
    # 外部の会話をつなぐとき：{"provider": "gchat"|"teams"|..., "ref": ..., "mode": "copy"|"summary"}
    external: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_by: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Post(Base):
    """チャンネルの発言とスレッドの返信、チケットのコメント。"""
    __tablename__ = "posts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[str] = mapped_column(String(32), index=True)
    channel_id: Mapped[str | None] = mapped_column(String(32), index=True, nullable=True)
    ticket_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)
    parent_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)  # スレッドの親
    author: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text)
    refs: Mapped[list | None] = mapped_column(JSON, nullable=True)
    mentions: Mapped[list | None] = mapped_column(JSON, nullable=True)
    source: Mapped[dict | None] = mapped_column(JSON, nullable=True)   # 外部から取り込んだ発言 {provider, url}
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Decision(Base):
    __tablename__ = "decisions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[str] = mapped_column(String(32), index=True)
    number: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(300))
    detail: Mapped[str] = mapped_column(Text, default="")
    rationale: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(12), default="proposed")  # proposed | confirmed | rejected | superseded
    stage_id: Mapped[str | None] = mapped_column(String(8), nullable=True)
    refs: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # {kind: thread|meeting|external|manual, id, url}
    source: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    proposed_by: Mapped[str] = mapped_column(String(200))
    decided_by: Mapped[str | None] = mapped_column(String(200), nullable=True)
    decided_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Meeting(Base):
    __tablename__ = "meetings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[str] = mapped_column(String(32), index=True)
    number: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(300))
    starts_at: Mapped[str | None] = mapped_column(String(25), nullable=True)   # ISO 8601（現地時刻のまま）
    attendees: Mapped[list | None] = mapped_column(JSON, nullable=True)
    agenda: Mapped[str] = mapped_column(Text, default="")
    transcript: Mapped[str] = mapped_column(Text, default="")
    minutes: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[dict | None] = mapped_column(JSON, nullable=True)            # 外部の会議 {provider, url}
    created_by: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Doc(Base):
    __tablename__ = "docs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[str] = mapped_column(String(32), index=True)
    number: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text, default="")
    refs: Mapped[list | None] = mapped_column(JSON, nullable=True)
    updated_by: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class Notice(Base):
    """メンションや担当の割り当ての通知。"""
    __tablename__ = "notices"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    user: Mapped[str] = mapped_column(String(200), index=True)
    product_id: Mapped[str] = mapped_column(String(32))
    kind: Mapped[str] = mapped_column(String(24))      # mention | assigned | decision
    text: Mapped[str] = mapped_column(String(300))
    link: Mapped[str] = mapped_column(String(300))
    actor: Mapped[str] = mapped_column(String(200))
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)


# ---------------- ジョブと自動開発（プリプロダクト） ----------------
class JobRun(Base):
    """長時間の処理（ジョブ）の1回分。Cloud Run Jobs で動かし、走行状況・履歴・LLM の使用量を残す。"""
    __tablename__ = "job_runs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    kind: Mapped[str] = mapped_column(String(24), index=True)          # autodev | ...（jobs.JOBS）
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    product_id: Mapped[str | None] = mapped_column(String(32), index=True, nullable=True)
    params: Mapped[dict] = mapped_column(JSON)                         # ジョブごとの入力
    status: Mapped[str] = mapped_column(String(12), default="queued")  # queued | running | done | failed | cancelled
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    progress: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # {done, total, step}
    log: Mapped[list | None] = mapped_column(JSON, nullable=True)       # [{at, step}]
    usage: Mapped[dict | None] = mapped_column(JSON, nullable=True)     # {calls, input_tokens, output_tokens, by_model}
    runner: Mapped[str] = mapped_column(String(20), default="thread")   # cloud-run-job | thread
    execution: Mapped[str | None] = mapped_column(String(300), nullable=True)  # Cloud Run Jobs の実行名
    # 工程（タスク）の依存関係と状態：[{id, name, group, deps, status, started_at, finished_at, error, detail, usage}]
    tasks: Mapped[list | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    model: Mapped[str] = mapped_column(String(120), default="")
    retry_of: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_by: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)
    started_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Variant(Base):
    """プリプロダクト（PP-n）：一つのプロダクトに複数ぶら下がる、動く試作つきのプロダクト案。"""
    __tablename__ = "variants"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[str] = mapped_column(String(32), index=True)
    run_id: Mapped[str] = mapped_column(String(32), index=True)
    number: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(200))
    concept: Mapped[str] = mapped_column(Text, default="")        # この案の考え方と、他の案との違い
    assumptions: Mapped[list | None] = mapped_column(JSON, nullable=True)
    drafts: Mapped[dict | None] = mapped_column(JSON, nullable=True)     # {stage_id: 下書き}
    prototype: Mapped[str] = mapped_column(Text, default="")      # 単一ファイルの HTML
    status: Mapped[str] = mapped_column(String(12), default="generating")  # generating | ready | failed | adopted
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    adopted_by: Mapped[str | None] = mapped_column(String(200), nullable=True)
    adopted_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)


# ---------------- 社内のオントロジー ----------------
class Concept(Base):
    """社内の用語・組織・役割・業務・システムなど（テナント全体で1つ）。"""
    __tablename__ = "concepts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    label: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(16), default="term")   # term | org | role | process | system | other
    definition: Mapped[str] = mapped_column(Text, default="")
    aliases: Mapped[list | None] = mapped_column(JSON, nullable=True)
    examples: Mapped[list | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(10), default="active")  # active | proposed（AI の候補）
    source: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    updated_by: Mapped[str] = mapped_column(String(200), default="")
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class Relation(Base):
    __tablename__ = "relations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    source_id: Mapped[int] = mapped_column(Integer, index=True)
    target_id: Mapped[int] = mapped_column(Integer, index=True)
    type: Mapped[str] = mapped_column(String(16))   # is_a | part_of | owned_by | uses | precedes | related
    note: Mapped[str] = mapped_column(String(300), default="")


# ---------------- 外部情報のリサーチライブラリ ----------------
class ResearchLibrary(Base):
    """トピックごとの資料室（RL-n）。記事を集め、ファクトを抜き出し、論点ごとにまとめる。"""
    __tablename__ = "research_libraries"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    number: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    instructions: Mapped[str] = mapped_column(Text, default="")        # 何を集めるか（検索の指示）
    use_search: Mapped[bool] = mapped_column(Boolean, default=True)
    feeds: Mapped[list | None] = mapped_column(JSON, nullable=True)    # RSS / Atom の URL
    sites: Mapped[list | None] = mapped_column(JSON, nullable=True)    # 変わったら取り込むページ（仕様・料金など）
    issues: Mapped[list | None] = mapped_column(JSON, nullable=True)   # 論点
    entities: Mapped[list | None] = mapped_column(JSON, nullable=True)  # 企業・団体（プレーヤー）
    issue_defs: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # 論点 → その論点で問うこと
    layers: Mapped[list | None] = mapped_column(JSON, nullable=True)    # プレーヤーの層（マップの段）
    topics: Mapped[list | None] = mapped_column(JSON, nullable=True)    # ファクトのテーマ
    since: Mapped[str | None] = mapped_column(String(10), nullable=True)   # 集める期間の始まり
    latest: Mapped[str | None] = mapped_column(String(10), nullable=True)  # 集めた記事の最新の日付
    updated_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ResearchArticle(Base):
    __tablename__ = "research_articles"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    library_id: Mapped[int] = mapped_column(Integer, index=True)
    number: Mapped[int] = mapped_column(Integer)                        # RA-n（テナントの中で振る）
    url: Mapped[str] = mapped_column(String(1000))
    title: Mapped[str] = mapped_column(String(500))
    title_ja: Mapped[str] = mapped_column(String(500), default="")      # 日本語の見出し（原題が外国語のとき）
    publisher: Mapped[str] = mapped_column(String(200), default="")
    published: Mapped[str | None] = mapped_column(String(10), nullable=True)
    region: Mapped[str] = mapped_column(String(10), default="unknown")  # domestic | overseas | unknown
    country: Mapped[str] = mapped_column(String(8), default="")         # JP・US など
    category: Mapped[str] = mapped_column(String(10), default="news")  # news | press | spec | public | other
    summary: Mapped[str] = mapped_column(Text, default="")
    issues: Mapped[list | None] = mapped_column(JSON, nullable=True)
    entities: Mapped[list | None] = mapped_column(JSON, nullable=True)
    checked: Mapped[bool] = mapped_column(Boolean, default=False)       # 本文を読んで要約したか
    origin: Mapped[str] = mapped_column(String(10), default="manual")   # search | rss | site | manual
    memo: Mapped[str] = mapped_column(Text, default="")
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    added_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ResearchFact(Base):
    """記事に書かれた数字・事実を1件ずつの行にしたもの（RF-n）。"""
    __tablename__ = "research_facts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    library_id: Mapped[int] = mapped_column(Integer, index=True)
    article_id: Mapped[int] = mapped_column(Integer, index=True)
    number: Mapped[int] = mapped_column(Integer)
    date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    kind: Mapped[str] = mapped_column(String(20), default="other")      # survey | market | usage | price | spec | other
    theme: Mapped[str] = mapped_column(String(100), default="")
    metric: Mapped[str] = mapped_column(String(300))                    # 何の数字か
    value: Mapped[str] = mapped_column(String(100))
    scope: Mapped[str] = mapped_column(String(300), default="")         # 対象・範囲
    source: Mapped[str] = mapped_column(String(300), default="")        # 出典（調査主体など）
    quote: Mapped[str] = mapped_column(Text, default="")
    verified: Mapped[bool] = mapped_column(Boolean, default=False)      # 原文に引用が見つかったか
    added_by: Mapped[str] = mapped_column(String(200), default="")
    added_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ResearchNote(Base):
    """論点のまとめ（issue）と、AI に頼んだ分析（analysis）。本文には根拠の RA-n を付ける。"""
    __tablename__ = "research_notes"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    library_id: Mapped[int] = mapped_column(Integer, index=True)
    kind: Mapped[str] = mapped_column(String(10))       # issue | analysis
    title: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text, default="")
    filters: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # 論点のまとめの構造（見出し・主張と根拠・反対の見方・国内）
    data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    articles: Mapped[int] = mapped_column(Integer, default=0)   # まとめたときの記事数
    created_by: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ResearchPlayer(Base):
    """プレーヤー（企業・団体）。層ごとのマップに並べ、記事での登場と最新の動きを見る。"""
    __tablename__ = "research_players"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    library_id: Mapped[int] = mapped_column(Integer, index=True)
    name: Mapped[str] = mapped_column(String(200))
    aliases: Mapped[list | None] = mapped_column(JSON, nullable=True)   # 記事の中での呼び方
    layer: Mapped[str] = mapped_column(String(100), default="")
    region: Mapped[str] = mapped_column(String(8), default="")          # JP・US など
    role: Mapped[str] = mapped_column(String(300), default="")          # 役割（1行）
    detail: Mapped[str] = mapped_column(Text, default="")
    stance: Mapped[str] = mapped_column(String(100), default="")        # 姿勢（推進・様子見・拒否 など）
    tags: Mapped[list | None] = mapped_column(JSON, nullable=True)      # 対応する規格・製品など
    latest: Mapped[dict | None] = mapped_column(JSON, nullable=True)    # 最新の動き {d, text, u}
    updated_by: Mapped[str] = mapped_column(String(200), default="")
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class ResearchQuestion(Base):
    """記事への質問。AI が元記事（読めなければ検索）を読んで答える。"""
    __tablename__ = "research_questions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    library_id: Mapped[int] = mapped_column(Integer, index=True)
    article_id: Mapped[int] = mapped_column(Integer, index=True)
    question: Mapped[str] = mapped_column(Text)
    state: Mapped[str] = mapped_column(String(10), default="pending")   # pending | running | answered | error
    answer: Mapped[str] = mapped_column(Text, default="")
    basis: Mapped[str] = mapped_column(String(10), default="")          # article | search | none
    sources: Mapped[list | None] = mapped_column(JSON, nullable=True)
    message: Mapped[str] = mapped_column(String(500), default="")
    job_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    asked_by: Mapped[str] = mapped_column(String(200))
    asked_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)
    answered_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ResearchReport(Base):
    """調査レポート（RR-n）：技術調査・業界調査・公的データ。AI が公開資料を読んで構造化してまとめる。"""
    __tablename__ = "research_reports"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    library_id: Mapped[int] = mapped_column(Integer, index=True)
    number: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(10))                       # tech | industry | public
    title: Mapped[str] = mapped_column(String(300))
    instructions: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(12), default="queued")   # queued | running | done | failed
    data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    sources: Mapped[list | None] = mapped_column(JSON, nullable=True)
    basis: Mapped[str] = mapped_column(String(12), default="")          # search | knowledge | stub
    error: Mapped[str] = mapped_column(String(500), default="")
    checked: Mapped[str | None] = mapped_column(String(10), nullable=True)
    job_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_by: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ImportDoc(Base):
    """取り込んだ資料（Office など）。本文を文章にして置き、工程の項目への割り当てはジョブで行う。"""
    __tablename__ = "import_docs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    product_id: Mapped[str] = mapped_column(String(32), index=True)
    filename: Mapped[str] = mapped_column(String(300))
    kind: Mapped[str] = mapped_column(String(10))                      # xlsx | docx | pptx | md | txt | csv
    size: Mapped[int] = mapped_column(Integer, default=0)
    text: Mapped[str] = mapped_column(Text, default="")
    outline: Mapped[list | None] = mapped_column(JSON, nullable=True)   # 見出し（シート・スライド・章）
    mode: Mapped[str] = mapped_column(String(10), default="propose")   # propose | fill
    stages: Mapped[list | None] = mapped_column(JSON, nullable=True)    # 割り当て先を絞るとき
    status: Mapped[str] = mapped_column(String(12), default="queued")   # queued | running | done | failed
    result: Mapped[list | None] = mapped_column(JSON, nullable=True)    # [{stage, field, label, action, reason}]
    job_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_by: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ProductReport(Base):
    """報告資料（RP-n）：工程の企画情報から範囲を選んで、AI がスライドの構成にまとめたもの。"""
    __tablename__ = "product_reports"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    product_id: Mapped[str] = mapped_column(String(32), index=True)
    number: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(300))
    audience: Mapped[str] = mapped_column(String(300), default="")
    purpose: Mapped[str] = mapped_column(Text, default="")
    selection: Mapped[list] = mapped_column(JSON)                       # [{stage, fields: [key]}]
    source: Mapped[str] = mapped_column(String(10), default="latest")   # latest（最新版、なければ下書き）| draft
    slides_hint: Mapped[int] = mapped_column(Integer, default=8)
    status: Mapped[str] = mapped_column(String(12), default="queued")   # queued | running | done | failed
    data: Mapped[dict | None] = mapped_column(JSON, nullable=True)      # {summary, slides: [...], basis: {stage: 版}}
    error: Mapped[str] = mapped_column(String(500), default="")
    job_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_by: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class AgentSchedule(Base):
    """自律エージェント（AG-n）：cron の時刻に、決めた仕事（工程の見直し・リサーチの更新など）をジョブで動かす。"""
    __tablename__ = "agent_schedules"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    product_id: Mapped[str] = mapped_column(String(32), index=True)
    number: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(200))
    task: Mapped[str] = mapped_column(String(20))                       # review | custom | research | report
    instruction: Mapped[str] = mapped_column(Text, default="")
    stages: Mapped[list | None] = mapped_column(JSON, nullable=True)
    params: Mapped[dict | None] = mapped_column(JSON, nullable=True)    # {library, scope, report}
    cron: Mapped[str] = mapped_column(String(100))
    timezone: Mapped[str] = mapped_column(String(40), default="Asia/Tokyo")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    next_run_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    last_run_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_job_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    runs: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)


class AgentFinding(Base):
    """自律エージェントの提案・指摘。人が採用・却下・返信する（返信には AI が答え、案を直す）。"""
    __tablename__ = "agent_findings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    product_id: Mapped[str] = mapped_column(String(32), index=True)
    schedule_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)
    job_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    stage_id: Mapped[str | None] = mapped_column(String(8), nullable=True)
    severity: Mapped[str] = mapped_column(String(10), default="info")   # info | warn | action
    title: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text, default="")
    proposals: Mapped[list | None] = mapped_column(JSON, nullable=True)  # [{field, label, value, reason}]
    status: Mapped[str] = mapped_column(String(10), default="open")     # open | accepted | rejected | noted
    thread: Mapped[list | None] = mapped_column(JSON, nullable=True)    # [{role, actor, text, at}]
    decided_by: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class TeamAgent(Base):
    """プロダクトのエージェント組織：司令塔（director）・PM（pm）・各工程の担当（s01〜s14）。"""
    __tablename__ = "team_agents"
    __table_args__ = (UniqueConstraint("product_id", "key"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    product_id: Mapped[str] = mapped_column(String(32), index=True)
    key: Mapped[str] = mapped_column(String(10))                        # director | pm | s01 …
    mission: Mapped[str] = mapped_column(Text, default="")
    cron: Mapped[str] = mapped_column(String(100))
    timezone: Mapped[str] = mapped_column(String(40), default="Asia/Tokyo")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    report: Mapped[dict | None] = mapped_column(JSON, nullable=True)    # {health, progress, summary, blockers, next}
    memory: Mapped[dict | None] = mapped_column(JSON, nullable=True)    # 司令塔：{strategy, priorities, decided_at}
    next_run_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    last_run_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_job_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    runs: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)


class AgentTask(Base):
    """エージェントが洗い出し、進み具合を最新にするタスク（TS-n）。人（PdM）が持つタスクもある。"""
    __tablename__ = "agent_tasks"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[str] = mapped_column(String(32), index=True)
    number: Mapped[int] = mapped_column(Integer)
    agent: Mapped[str] = mapped_column(String(10))                      # 持っているエージェント
    title: Mapped[str] = mapped_column(String(300))
    detail: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(10), default="todo")     # todo | doing | blocked | done
    owner: Mapped[str] = mapped_column(String(10), default="agent")     # agent | pdm
    created_by: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class BoardPost(Base):
    """掲示板：エージェント同士・PdM とのやり取りを全部残す（A2A のメッセージと同じ形）。
    thread は最初の投稿の id（最初の投稿は自分の id）。"""
    __tablename__ = "board_posts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    product_id: Mapped[str] = mapped_column(String(32), index=True)
    thread: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)
    title: Mapped[str] = mapped_column(String(300), default="")
    sender: Mapped[str] = mapped_column(String(10))                     # director | pm | sNN | pdm
    recipient: Mapped[str] = mapped_column(String(10))                  # 同上 | all
    intent: Mapped[str] = mapped_column(String(12))                     # 報告・依頼・回答・決定・指示・質問
    text: Mapped[str] = mapped_column(Text)
    author: Mapped[str] = mapped_column(String(200), default="")        # PdM の投稿は人のメール、AI はモデル名
    read: Mapped[bool] = mapped_column(Boolean, default=False)          # 宛先が読んだか
    job_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)


class AgentAvatar(Base):
    """エージェントの顔（テナントで共通の配役）。画像生成AIで同じ画風にそろえて描く。"""
    __tablename__ = "agent_avatars"
    __table_args__ = (UniqueConstraint("tenant_id", "key"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    key: Mapped[str] = mapped_column(String(10))
    mime: Mapped[str] = mapped_column(String(40))
    data: Mapped[bytes] = mapped_column(LargeBinary)
    prompt: Mapped[str] = mapped_column(Text, default="")
    model: Mapped[str] = mapped_column(String(80), default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)


class TenantSecret(Base):
    """テナントの秘密情報（GitHub のトークンなど）。値は暗号化して置く。"""
    __tablename__ = "tenant_secrets"
    tenant_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(40), primary_key=True)
    value_enc: Mapped[str] = mapped_column(Text)
    hint: Mapped[str] = mapped_column(String(8), default="")
    updated_by: Mapped[str] = mapped_column(String(200), default="")
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class LlmSetting(Base):
    """LLM の接続設定。scope は "app"（運用者が決めるアプリ全体の既定）か "t:<テナントID>"（テナントの上書き）。"""
    __tablename__ = "llm_settings"
    scope: Mapped[str] = mapped_column(String(80), primary_key=True)
    provider: Mapped[str] = mapped_column(String(16))          # stub | gemini | vertex | anthropic | openai
    chat_model: Mapped[str] = mapped_column(String(120), default="")
    summary_model: Mapped[str] = mapped_column(String(120), default="")
    image_model: Mapped[str] = mapped_column(String(120), default="")
    base_url: Mapped[str | None] = mapped_column(String(500), nullable=True)   # OpenAI 互換（ローカルLLM など）
    project: Mapped[str | None] = mapped_column(String(100), nullable=True)    # Vertex AI
    location: Mapped[str | None] = mapped_column(String(50), nullable=True)
    key_enc: Mapped[str | None] = mapped_column(Text, nullable=True)           # 暗号化した API キー
    key_hint: Mapped[str | None] = mapped_column(String(8), nullable=True)     # 画面に出す末尾4文字
    # app のみ：テナントにキー不要の Vertex を許す
    allow_tenant_vertex: Mapped[bool] = mapped_column(Boolean, default=False)
    # テナントの行のみ：プラットフォーム管理者が自分で選んだ Vertex（全テナントへの許可がなくても有効）
    platform_granted: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_by: Mapped[str] = mapped_column(String(200), default="")
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class AuditLog(Base):
    """追記のみ（設計書 6.3）。更新・削除するAPIは用意しない。"""
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    product_id: Mapped[str | None] = mapped_column(String(32), index=True, nullable=True)
    stage_id: Mapped[str | None] = mapped_column(String(8), nullable=True)
    actor_type: Mapped[str] = mapped_column(String(8))   # human | agent | system
    actor: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(32))
    target_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    body: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)


def database_url() -> str:
    return os.environ.get("DATABASE_URL", "sqlite:///./factory.db")


def pool_kwargs() -> dict:
    """接続プールの上限。PF_DB_POOL_SIZE があるときだけ絞る。

    Supabase の接続プール（session モード）は同時接続数に上限があるので、
    工場DB用とADK用のエンジンそれぞれをこの数に抑える。
    """
    size = os.environ.get("PF_DB_POOL_SIZE")
    if not size:
        return {}
    return {"pool_size": int(size), "max_overflow": 0, "pool_pre_ping": True}


def async_session_db_url(url: str | None = None) -> str:
    """ADK の DatabaseSessionService 用（非同期ドライバ）。工場DBと同じDBに同居させる。"""
    url = url or database_url()
    if url.startswith("sqlite:///"):
        return url.replace("sqlite:///", "sqlite+aiosqlite:///", 1)
    if url.startswith("postgresql+psycopg://"):
        return url  # psycopg3 は同期・非同期の両方に対応
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


def sync_url(url: str | None = None) -> str:
    url = url or database_url()
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


_engine = None
_Session = None


def init_db(url: str | None = None):
    global _engine, _Session
    _engine = create_engine(sync_url(url), future=True, **pool_kwargs())
    Base.metadata.create_all(_engine)
    _add_missing_columns(_engine)
    _widen_columns(_engine)
    _Session = sessionmaker(_engine, expire_on_commit=False, future=True)
    return _engine


# create_all は既存テーブルに列を足さないので、後から足した列だけここで追加する
_ADDED_COLUMNS = {
    "stage_runs": {"draft": "JSON", "enabled": "BOOLEAN DEFAULT {true}",
                   "approval_required": "BOOLEAN DEFAULT {false}"},
    "artifacts": {"data": "JSON"},
    "products": {"cover_image_id": "VARCHAR(32)", "repo": "VARCHAR(200)", "repo_branch": "VARCHAR(100)",
                 "gh_sync": "VARCHAR(8) DEFAULT 'off'", "gh_import": "BOOLEAN DEFAULT {false}",
                 "gh_synced_at": "VARCHAR(30)"},
    "chat_messages": {"session_id": "VARCHAR(32)"},
    "llm_settings": {"platform_granted": "BOOLEAN DEFAULT {false}"},
    "job_runs": {"tasks": "JSON"},
    "product_images": {"base_id": "VARCHAR(32)"},
    "research_libraries": {"issue_defs": "JSON", "layers": "JSON", "topics": "JSON"},
    "research_articles": {"title_ja": "VARCHAR(500) DEFAULT ''", "country": "VARCHAR(8) DEFAULT ''"},
    "research_notes": {"data": "JSON"},
}


# create_all は既存の列の型を変えないので、後から広げた文字列の列だけここで広げる（SQLite は長さを見ないので不要）
_WIDENED = {("job_runs", "runner"): 20}


def _widen_columns(engine) -> None:
    if engine.dialect.name == "sqlite":
        return
    insp = inspect(engine)
    with engine.begin() as conn:
        for (table, name), length in _WIDENED.items():
            col = next((c for c in insp.get_columns(table) if c["name"] == name), None)
            if col is not None and (getattr(col["type"], "length", None) or length) < length:
                conn.execute(text(f"ALTER TABLE {table} ALTER COLUMN {name} TYPE VARCHAR({length})"))


def _add_missing_columns(engine) -> None:
    sqlite = engine.dialect.name == "sqlite"
    true_, false_ = ("1", "0") if sqlite else ("TRUE", "FALSE")
    insp = inspect(engine)
    with engine.begin() as conn:
        for table, cols in _ADDED_COLUMNS.items():
            have = {c["name"] for c in insp.get_columns(table)}
            for name, ddl in cols.items():
                if name not in have:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} "
                                      + ddl.format(true=true_, false=false_)))


def session():
    if _Session is None:
        init_db()
    return _Session()
