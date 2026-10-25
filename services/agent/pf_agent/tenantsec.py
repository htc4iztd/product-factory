"""テナントの秘密情報（GitHub のトークンなど）。LLM の API キーと同じ鍵で暗号化して DB に置く。"""
from __future__ import annotations

from .db import AuditLog, TenantSecret, session
from .llmconf import _decrypt, _encrypt


def get(tenant_id: str, name: str) -> str | None:
    with session() as s:
        row = s.get(TenantSecret, (tenant_id, name))
        return _decrypt(row.value_enc) if row else None


def hint(tenant_id: str, name: str) -> str | None:
    with session() as s:
        row = s.get(TenantSecret, (tenant_id, name))
        return row.hint if row else None


def put(tenant_id: str, name: str, value: str | None, user: str) -> None:
    """value が空なら消す。値そのものは監査ログに残さない。"""
    with session() as s:
        row = s.get(TenantSecret, (tenant_id, name))
        if not value:
            if row is not None:
                s.delete(row)
            action = "cleared"
        else:
            if row is None:
                row = TenantSecret(tenant_id=tenant_id, name=name, value_enc="")
                s.add(row)
            row.value_enc, row.hint, row.updated_by = _encrypt(value), value[-4:], user
            action = "updated"
        s.add(AuditLog(tenant_id=tenant_id, product_id=None, stage_id=None, actor_type="human", actor=user,
                       kind="settings.secret", body={"name": name, "action": action}))
        s.commit()
