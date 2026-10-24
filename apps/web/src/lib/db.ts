import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";

// テーブルは pg で直接扱う
// （3テーブルだけなのでコード生成を持ち込まない）。
const g = globalThis as unknown as { pfPool?: Pool; pfReady?: Promise<void> };
// PF_DB_POOL_SIZE：Supabase の接続プール（session モード）の上限に収めるための同時接続数
export const pool = g.pfPool ?? new Pool({ ...connection(process.env.DATABASE_URL), max: Number(process.env.PF_DB_POOL_SIZE ?? 10) });

// sslmode=require は agent 側（libpq）と同じく「暗号化するが証明書は検証しない」に揃える。
// pg は require を verify-full として扱い、Supabase 独自の CA で失敗するため
function connection(url: string | undefined) {
  if (!url) return { connectionString: url };
  const u = new URL(url);
  if (u.searchParams.get("sslmode") !== "require") return { connectionString: url };
  u.searchParams.delete("sslmode");
  return { connectionString: u.toString(), ssl: { rejectUnauthorized: false } };
}
g.pfPool = pool;

export function ready(): Promise<void> {
  if (!g.pfReady) {
    const sql = readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8");
    g.pfReady = pool.query(sql).then(() => undefined);
  }
  return g.pfReady;
}

export const newId = () => randomUUID().replace(/-/g, "");

export type Role = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

export async function findUserByEmail(email: string) {
  await ready();
  const r = await pool.query("SELECT id, email, name, password FROM pf_user WHERE email = $1", [email]);
  return r.rows[0] as { id: string; email: string; name: string | null; password: string | null } | undefined;
}

export async function latestMembership(userId: string) {
  await ready();
  const r = await pool.query(
    `SELECT m.tenant_id, m.role, t.mode FROM pf_tenant_member m JOIN pf_tenant t ON t.id = m.tenant_id
     WHERE m.user_id = $1 ORDER BY m.joined_at DESC LIMIT 1`,
    [userId],
  );
  return r.rows[0] as { tenant_id: string; role: Role; mode: string } | undefined;
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  await ready();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
