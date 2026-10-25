"""LLM の接続設定。

- アプリ全体の既定（scope="app"）はプラットフォーム管理者（PF_ADMIN_EMAILS）が決める。
- テナントは OWNER が自分の接続で上書きできる（scope="t:<テナントID>"）。行が無ければ既定を使う。
- どちらも無ければ環境変数（GOOGLE_API_KEY / PF_LLM / PF_MODEL）に従う。何も無ければスタブ。
- API キーは PF_SECRET_KEY から作る鍵で暗号化して DB に置き、画面には末尾4文字だけを返す。
- キー不要の Vertex AI はアプリの GCP の費用になる。選べるのはプラットフォーム管理者と、
  管理者が全テナントに許したときだけ。
- OpenAI 互換の URL（ローカルLLM など）は、テナントからは公開アドレスだけを受け付ける（内部への到達を防ぐ）。
"""
from __future__ import annotations

import base64
import hashlib
import ipaddress
import os
import re
import socket
from dataclasses import dataclass
from urllib.parse import urlparse

from .db import AuditLog, LlmSetting, session

PROVIDERS = {
    "stub": "スタブ（AIを使わない）",
    "gemini": "Gemini API",
    "vertex": "Vertex AI（Gemini・Claude）",
    "anthropic": "Anthropic API（Claude）",
    "openai": "OpenAI 互換 API（ローカルLLM など）",
}
NEEDS_KEY = {"gemini", "anthropic"}
DEFAULT_MODELS = {
    "stub": {"chat": "stub", "summary": "stub", "image": "stub"},
    "gemini": {"chat": "gemini-2.5-flash", "summary": "gemini-2.5-flash", "image": "gemini-3.1-flash-image"},
    "vertex": {"chat": "gemini-2.5-flash", "summary": "gemini-2.5-flash", "image": "gemini-3.1-flash-image"},
    "anthropic": {"chat": "claude-opus-5-5", "summary": "claude-opus-5-5", "image": ""},
    "openai": {"chat": "", "summary": "", "image": ""},
}
# 画面で候補として出すモデル（自由入力もできる）
SUGGESTED_MODELS = {
    "gemini": ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite"],
    "vertex": ["gemini-2.5-flash", "gemini-2.5-pro", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
    "anthropic": ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
    "openai": [],
}
IMAGE_PROVIDERS = {"gemini", "vertex"}


class ConfigError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


@dataclass
class Conn:
    provider: str
    chat_model: str
    summary_model: str
    image_model: str
    source: str                  # tenant | app | env
    api_key: str | None = None
    base_url: str | None = None
    project: str | None = None
    location: str | None = None
    allow_private: bool = False  # OpenAI 互換の URL に内部アドレスを許すか（プラットフォーム管理者の設定だけ）

    def label(self, use: str = "chat") -> str:
        return {"chat": self.chat_model, "summary": self.summary_model, "image": self.image_model}[use] or self.provider


# ---------------- 暗号化 ----------------
def _fernet():
    from cryptography.fernet import Fernet
    secret = os.environ.get("PF_SECRET_KEY")
    if not secret:
        if os.environ.get("K_SERVICE"):  # Cloud Run で鍵が無いまま保存させない
            raise ConfigError(500, "PF_SECRET_KEY が設定されていないため、API キーを保存できません")
        secret = "dev-secret-key"
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest()))


def _encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def _decrypt(token: str | None) -> str | None:
    if not token:
        return None
    try:
        return _fernet().decrypt(token.encode()).decode()
    except Exception:  # 鍵を入れ替えた等。キーが無い扱いにして画面で入れ直してもらう
        return None


# ---------------- 権限 ----------------
def admin_configured() -> bool:
    return bool(os.environ.get("PF_ADMIN_EMAILS", "").strip())


def is_admin(email: str) -> bool:
    admins = {e.lower() for e in re.split(r"[,;\s]+", os.environ.get("PF_ADMIN_EMAILS", "")) if e}
    return email.lower() in admins


def _default_project() -> str | None:
    return os.environ.get("GOOGLE_CLOUD_PROJECT") or os.environ.get("PF_VERTEX_PROJECT")


def _default_location() -> str:
    return os.environ.get("PF_VERTEX_LOCATION", "global")


# ---------------- URL の検査 ----------------
def check_url(url: str, allow_private: bool) -> str:
    u = urlparse(url.strip())
    if u.scheme not in ("http", "https") or not u.hostname:
        raise ConfigError(422, "URL は http(s)://ホスト/... の形で入れてください")
    if allow_private:
        return url.strip().rstrip("/")
    if u.scheme != "https":
        raise ConfigError(422, "テナントの設定では https の URL だけを使えます")
    try:
        infos = socket.getaddrinfo(u.hostname, u.port or 443)
    except socket.gaierror:
        raise ConfigError(422, f"{u.hostname} の名前を引けません") from None
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            raise ConfigError(422, "内部ネットワークのアドレスには接続できません（公開 URL を使ってください）")
    return url.strip().rstrip("/")


# ---------------- 読み書き ----------------
def _row(scope: str) -> LlmSetting | None:
    with session() as s:
        return s.get(LlmSetting, scope)


def _env_conn() -> Conn:
    mode = os.environ.get("PF_LLM", "").lower()
    key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if mode == "stub" or (not mode and not key):
        p = "stub"
    elif mode in PROVIDERS:
        p = mode
    else:
        p = "gemini"
    d = DEFAULT_MODELS[p]
    chat = os.environ.get("PF_MODEL") or d["chat"]
    return Conn(provider=p, chat_model=chat, summary_model=chat,
                image_model=os.environ.get("PF_IMAGE_MODEL") or d["image"], source="env",
                api_key=os.environ.get("ANTHROPIC_API_KEY") if p == "anthropic" else key,
                base_url=os.environ.get("PF_LLM_BASE_URL"), project=_default_project(),
                location=_default_location(), allow_private=True)


def _conn(r: LlmSetting, source: str) -> Conn:
    d = DEFAULT_MODELS.get(r.provider, DEFAULT_MODELS["stub"])
    return Conn(provider=r.provider, chat_model=r.chat_model or d["chat"],
                summary_model=r.summary_model or r.chat_model or d["summary"],
                image_model=r.image_model or d["image"], source=source, api_key=_decrypt(r.key_enc),
                base_url=r.base_url, project=r.project or _default_project(),
                location=r.location or _default_location(), allow_private=source == "app")


def app_conn() -> Conn:
    r = _row("app")
    return _conn(r, "app") if r else _env_conn()


def resolve(tenant_id: str) -> Conn:
    r = _row(f"t:{tenant_id}")
    if r is None:
        return app_conn()
    if r.provider == "vertex" and not (r.platform_granted or allow_tenant_vertex()):
        return app_conn()  # プラットフォーム管理者が許可を外したら既定に戻す
    c = _conn(r, "tenant")
    if c.provider == "vertex":  # テナントはプラットフォーム管理者のプロジェクトだけを使う
        c.project = _default_project()
    return c


def allow_tenant_vertex() -> bool:
    r = _row("app")
    return bool(r and r.allow_tenant_vertex)


def view(scope: str) -> dict | None:
    r = _row(scope)
    if r is None:
        return None
    return {"provider": r.provider, "chat_model": r.chat_model, "summary_model": r.summary_model,
            "image_model": r.image_model, "base_url": r.base_url, "project": r.project, "location": r.location,
            "key_hint": r.key_hint, "has_key": bool(r.key_enc), "allow_tenant_vertex": r.allow_tenant_vertex,
            "platform_granted": r.platform_granted,
            "updated_by": r.updated_by, "updated_at": r.updated_at.isoformat() if r.updated_at else None}


def describe(c: Conn) -> dict:
    return {"provider": c.provider, "provider_label": PROVIDERS.get(c.provider, c.provider), "source": c.source,
            "chat_model": c.chat_model, "summary_model": c.summary_model,
            "image_model": c.image_model if c.provider in IMAGE_PROVIDERS else "",
            "base_url": c.base_url if c.provider == "openai" else None,
            "location": c.location if c.provider == "vertex" else None}


def save(scope: str, tenant_id: str, user: str, body: dict, by_admin: bool = False) -> None:
    """provider が "inherit" ならテナントの上書きを消す。api_key は空なら据え置き、clear_key で消す。

    by_admin：プラットフォーム管理者による保存。管理者は自分のテナントでも Vertex AI を選べる。
    """
    is_app = scope == "app"
    provider = body.get("provider", "")
    with session() as s:
        row = s.get(LlmSetting, scope)
        if provider == "inherit" and not is_app:
            if row is not None:
                s.delete(row)
            _audit(s, tenant_id, user, scope, {"provider": "inherit"})
            s.commit()
            return
        if provider not in PROVIDERS:
            raise ConfigError(422, f"接続方式は {list(PROVIDERS)} のどれか")
        granted = bool(row and row.platform_granted and row.provider == "vertex")
        if provider == "vertex" and not (is_app or by_admin or granted or allow_tenant_vertex()):
            raise ConfigError(403, "Vertex AI（キー不要）はアプリのプラットフォーム管理者が許可したときだけ選べます")
        if row is None:
            row = LlmSetting(scope=scope, provider=provider)
            s.add(row)
        changed_provider = row.provider != provider
        row.provider = provider
        for k in ("chat_model", "summary_model", "image_model"):
            row.__setattr__(k, str(body.get(k) or "").strip()[:120])
        row.base_url = check_url(body["base_url"], is_app) if provider == "openai" and body.get("base_url") else None
        if provider == "openai" and not row.base_url:
            raise ConfigError(422, "OpenAI 互換 API の URL を入れてください（例：https://example.com/v1）")
        if provider == "openai" and not row.chat_model:
            raise ConfigError(422, "OpenAI 互換 API では、対話のモデル名を入れてください")
        row.project = (str(body.get("project") or "").strip() or None) if is_app else None
        row.location = (str(body.get("location") or "").strip() or None) if provider == "vertex" else None
        key = str(body.get("api_key") or "").strip()
        if body.get("clear_key") or (changed_provider and not key):
            row.key_enc, row.key_hint = None, None
        if key:
            row.key_enc, row.key_hint = _encrypt(key), key[-4:]
        if provider in NEEDS_KEY and not row.key_enc:
            raise ConfigError(422, f"{PROVIDERS[provider]} には API キーが要ります")
        if is_app:
            row.allow_tenant_vertex = bool(body.get("allow_tenant_vertex"))
        else:
            row.platform_granted = provider == "vertex" and (by_admin or granted)
        row.updated_by = user
        _audit(s, tenant_id, user, scope, {
            "provider": provider, "chat_model": row.chat_model, "summary_model": row.summary_model,
            "image_model": row.image_model, "base_url": row.base_url, "location": row.location,
            "key": "updated" if key else ("cleared" if row.key_enc is None else "kept"),
            **({"allow_tenant_vertex": row.allow_tenant_vertex} if is_app else {})})
        s.commit()


def _audit(s, tenant_id: str, user: str, scope: str, body: dict) -> None:
    # キーの値は残さない
    s.add(AuditLog(tenant_id=tenant_id, product_id=None, stage_id=None, actor_type="human", actor=user,
                   kind="settings.llm", body={"scope": "app" if scope == "app" else "tenant", **body}))


def options() -> dict:
    return {"providers": PROVIDERS, "defaults": DEFAULT_MODELS, "suggested": SUGGESTED_MODELS,
            "needs_key": sorted(NEEDS_KEY), "image_providers": sorted(IMAGE_PROVIDERS),
            "vertex_project": _default_project(), "vertex_location": _default_location()}

