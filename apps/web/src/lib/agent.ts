import "server-only";
import { auth } from "./auth";

// agent-api への呼び出しは必ずサーバー側から行う。
// 呼び出し元の文脈（ユーザー・テナント・基本ロール）はセッションからだけ組み立てる。
const BASE = process.env.AGENT_API_URL ?? "http://localhost:8100";
const TOKEN = process.env.PF_INTERNAL_TOKEN ?? "dev-internal-token";
// Cloud Run では agent-api を IAM で閉じる。web のサービスアカウントの ID トークンを付けて呼ぶ。
const ID_TOKEN = process.env.AGENT_AUTH === "google-id-token";

let idToken: { value: string; exp: number } | null = null;

async function googleIdToken(): Promise<string> {
  if (idToken && idToken.exp > Date.now()) return idToken.value;
  const url = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(BASE)}`;
  const res = await fetch(url, { headers: { "Metadata-Flavor": "Google" }, cache: "no-store" });
  if (!res.ok) throw new AgentError(502, `ID トークンを取得できません（${res.status}）`);
  // トークンの有効期限は1時間。余裕を持って50分で取り直す
  idToken = { value: await res.text(), exp: Date.now() + 50 * 60 * 1000 };
  return idToken.value;
}

export class AgentError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function agent<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const session = await auth();
  if (!session?.user?.tenantId || !session.user.role) throw new AgentError(401, "ログインしてください");
  const res = await fetch(`${BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "content-type": "application/json",
      "x-pf-internal-token": TOKEN,
      "x-pf-user": session.user.email,
      "x-pf-tenant": session.user.tenantId,
      "x-pf-role": session.user.role,
      ...(ID_TOKEN ? { authorization: `Bearer ${await googleIdToken()}` } : {}),
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {}
    throw new AgentError(res.status, typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return (await res.json()) as T;
}

export type Phase = {
  id: string; name: string; gate: string | null; gate_question: string | null;
  stages: string[]; unlocked: boolean; complete: boolean;
  review: { decision: string; reason: string; actor: string; at: string } | null;
};
export type StageSummary = {
  id: string; no: string; name: string; phase: string; status: string;
  pending_kind: string | null; current_version: number; approved_version: number;
};
export type Product = { id: string; name: string; idea: string; scope: string; mode: string; status: string; created_at: string };
export type Overview = { product: Product; phases: Phase[]; stages: StageSummary[] };
export type Pending = { id: string; kind: "clarify" | "approval"; message: string; payload: Record<string, unknown> };
export type StageDetail = {
  id: string; no: string; name: string; phase: string; artifact_name: string; required_sections: string[];
  inputs: string[]; status: string; pending: Pending | null; answers: string | null; audit_findings: string[] | null;
  current_version: number; approved_version: number;
  artifact: { version: number; content: string; sha256: string; approved: boolean } | null;
};
export type AuditRow = {
  id: number; at: string; stage_id: string | null; actor_type: string; actor: string; kind: string;
  target_version: number | null; body: Record<string, unknown> | null; reason: string | null;
};

export const STATUS_LABEL: Record<string, string> = {
  not_started: "未着手", in_progress: "進行中", awaiting_approval: "承認待ち", revising: "修正中",
  completed: "完了", skipped: "スキップ", needs_recheck: "要再確認",
};
