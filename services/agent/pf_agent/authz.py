"""認可（設計書 10.1）。

- テナントはリクエスト本文からは決めない。web が自分のセッションから決めた値を
  内部トークン付きのヘッダで渡し、agent-api はそれだけを信じる。
- 基本ロール：OWNER > ADMIN > MEMBER > VIEWER
- 工程ロール：viewer / assignee / approver / owner を工程グループごとに付与
- 個人モードでは本人が全ロールを持つ。
"""
from __future__ import annotations

import os
from dataclasses import dataclass

from fastapi import Header, HTTPException

BASE_ORDER = {"VIEWER": 0, "MEMBER": 1, "ADMIN": 2, "OWNER": 3}

# 工程グループ（設計書 10.1）
STAGE_GROUP = {
    "s01": "business", "s02": "business", "s03": "business", "s04": "business",
    "s05": "business",  # ⑤の財務モデル表は R2 で finance グループに分ける
    "s06": "design", "s07": "design", "s08": "design", "s09": "design",
    "s10": "design", "s11": "design",
    "s12": "build", "s13": "build",
    "s14": "release",
}
GATE_GROUP = {"P1": "business", "P2": "business", "P3": "design", "P4": "build"}

# 工程ロールでできる操作
PROCESS_OPS = {
    "viewer": {"view"},
    "assignee": {"view", "create"},
    "approver": {"view", "approve"},
    "owner": {"view", "create", "approve", "review", "assign"},
}
# 基本ロールが持てる工程ロールの上限
BASE_CAP = {
    "VIEWER": {"viewer"},
    "MEMBER": {"viewer", "assignee", "approver"},
    "ADMIN": {"viewer", "assignee", "approver", "owner"},
    "OWNER": {"viewer", "assignee", "approver", "owner"},
}


@dataclass
class Caller:
    user: str
    tenant: str
    base_role: str


def caller(x_pf_internal_token: str = Header(default=""),
           x_pf_user: str = Header(default=""),
           x_pf_tenant: str = Header(default=""),
           x_pf_role: str = Header(default="")) -> Caller:
    expected = os.environ.get("PF_INTERNAL_TOKEN", "dev-internal-token")
    if x_pf_internal_token != expected:
        raise HTTPException(401, "invalid internal token")
    if not x_pf_user or not x_pf_tenant or x_pf_role not in BASE_ORDER:
        raise HTTPException(401, "missing caller context")
    return Caller(user=x_pf_user, tenant=x_pf_tenant, base_role=x_pf_role)


def process_role(c: Caller, mode: str, assigned: str | None) -> str:
    """個人モードは OWNER 本人が全ロール。法人モードは割当（R3で画面化）を基本ロールで頭打ちにする。"""
    if mode == "personal":
        return "owner" if c.base_role in ("OWNER", "ADMIN") else "viewer"
    role = assigned or "viewer"
    return role if role in BASE_CAP[c.base_role] else "viewer"


def require(c: Caller, product, group: str, op: str, assigned: str | None = None) -> None:
    if product is None or product.tenant_id != c.tenant:
        raise HTTPException(404, "product not found")
    role = process_role(c, product.mode, assigned)
    if op not in PROCESS_OPS[role]:
        raise HTTPException(403, f"process role '{role}' cannot '{op}' in group '{group}'")
