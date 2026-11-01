"""GitHub の接続（テナントのトークン）。コード（IDE）・自動開発が使う。

チケットと GitHub Issues の同期は、チケットの廃止とともに外した（エージェントの Issue に一本化）。
"""
from __future__ import annotations

import os

from . import code, tenantsec

__all__ = ["code", "token", "SyncError"]


class SyncError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def token(tenant_id: str) -> tuple[str | None, str]:
    t = tenantsec.get(tenant_id, "github_token")
    if t:
        return t, "tenant"
    if os.environ.get("GITHUB_TOKEN"):
        return os.environ["GITHUB_TOKEN"], "server"
    return None, "none"
