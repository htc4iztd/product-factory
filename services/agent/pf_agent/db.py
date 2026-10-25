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
    approved_version: Mapped[int] = mapped_column(Integer, default=0)   # 確定した最新の版
    # 作業中の下書き（フレームワークの項目ごとの値）。確定すると Artifact の版になる
    draft: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # プロダクトごとの設定：このステージを使うか、確定に承認が要るか
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
    kind: Mapped[str] = mapped_column(String(16))           # scene | ui | concept
    note: Mapped[str] = mapped_column(Text, default="")
    prompt: Mapped[str] = mapped_column(Text)
    model: Mapped[str] = mapped_column(String(80))
    mime: Mapped[str] = mapped_column(String(40))
    data: Mapped[bytes] = mapped_column(LargeBinary)
    created_by: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ChatMessage(Base):
    """ステージごとのAIとの対話。assistant の発言には項目の書き換え案（proposals）が付く。"""
    __tablename__ = "chat_messages"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id"), index=True)
    stage_id: Mapped[str] = mapped_column(String(8))
    role: Mapped[str] = mapped_column(String(12))       # user | assistant | feedback
    actor: Mapped[str] = mapped_column(String(200))
    text: Mapped[str] = mapped_column(Text, default="")
    # [{"id", "field", "value", "reason", "status": pending|accepted|rejected}]
    proposals: Mapped[list | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=_now)


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
    _Session = sessionmaker(_engine, expire_on_commit=False, future=True)
    return _engine


# create_all は既存テーブルに列を足さないので、後から足した列だけここで追加する
_ADDED_COLUMNS = {
    "stage_runs": {"draft": "JSON", "enabled": "BOOLEAN DEFAULT {true}",
                   "approval_required": "BOOLEAN DEFAULT {false}"},
    "artifacts": {"data": "JSON"},
    "products": {"cover_image_id": "VARCHAR(32)"},
}


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
