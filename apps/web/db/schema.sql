-- 認証認可のテーブル（Tenant / User / TenantMember / MemberRole）
-- 段階Aで部門・プロダクト所属・工程ロールを追加する。
DO $$ BEGIN
  CREATE TYPE member_role AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS pf_tenant (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  mode       TEXT NOT NULL DEFAULT 'personal',   -- personal | corporate（利用モード）
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pf_user (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  name       TEXT,
  password   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pf_tenant_member (
  id        TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES pf_tenant(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES pf_user(id) ON DELETE CASCADE,
  role      member_role NOT NULL DEFAULT 'MEMBER',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);
