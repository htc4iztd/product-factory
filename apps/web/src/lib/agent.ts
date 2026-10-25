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

async function call(path: string, init?: { method?: string; body?: unknown }): Promise<Response> {
  const session = await auth();
  if (!session?.user?.tenantId || !session.user.role) throw new AgentError(401, "ログインしてください");
  return fetch(`${BASE}${path}`, {
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
}

// 画像など JSON 以外をそのまま受け取る
export async function agentRaw(path: string): Promise<Response> {
  return call(path);
}

export async function agent<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await call(path, init);
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
  stages: string[]; active: number; done: number; complete: boolean;
  review: { decision: string; reason: string; actor: string; at: string } | null;
};
export type StageSummary = {
  id: string; no: string; name: string; phase: string; framework: string; status: string;
  enabled: boolean; approval_required: boolean; pending_kind: string | null;
  current_version: number; approved_version: number;
};
export type Product = {
  id: string; name: string; idea: string; scope: string; mode: string; status: string;
  cover_image_id: string | null; created_at: string;
};
export type CanvasImage = { id: string; kind: string; note: string; prompt: string; model: string; created_by: string; created_at: string };
export type CanvasInfo = {
  product: Product; kinds: Record<string, string>; model: string;
  facts: { stage: string; label: string; value: string; source: string }[]; images: CanvasImage[];
};
export type Overview = { product: Product; phases: Phase[]; stages: StageSummary[] };

export type Column = { key: string; label: string; kind: "text" | "number"; options: string[] };
export type FieldSpec = {
  key: string; label: string; kind: "text" | "list" | "table" | "flows"; hint: string; required: boolean;
  columns: Column[]; rows: string[]; id_prefix: string;
};
export type Row = Record<string, string | number>;
export type FlowNode = { id: string; type: "start" | "task" | "decision" | "system" | "end"; label: string; lane: number; x: number };
export type FlowEdge = { id: string; source: string; target: string; label: string; sourceHandle?: string; targetHandle?: string };
export type Flow = { business: string; lanes: string[]; nodes: FlowNode[]; edges: FlowEdge[] };
export type FieldValue = string | string[] | Row[] | Flow[];
export type Draft = Record<string, FieldValue>;
export type Proposal = { id: string; field: string; value: FieldValue; reason: string; status: "pending" | "accepted" | "rejected" };
export type ChatMsg = { id: number; session_id: string | null; role: "user" | "assistant" | "feedback"; actor: string; text: string; proposals: Proposal[]; at: string };
export type ChatSession = { id: string; title: string; created_by: string; created_at: string; messages: number };
export type StageReport = { content: string; model: string; created_by: string; created_at: string; newer_messages: number };
export type StageRef = { id: string; no: string; name: string; status?: string; enabled?: boolean };
export type StageDetail = {
  id: string; no: string; name: string; phase: string;
  framework: { view: string; title: string; summary: string; fields: FieldSpec[]; prompts: string[] };
  status: string; enabled: boolean; approval_required: boolean;
  pending: { kind: string; version: number } | null; audit_findings: string[] | null; missing: string[];
  current_version: number; approved_version: number; dirty: boolean;
  draft: Draft; chat: ChatMsg[]; markdown: string;
  sessions: ChatSession[]; session_id: string | null; report: StageReport | null;
  versions: { version: number; confirmed: boolean; sha256: string; created_at: string }[];
  inputs: StageRef[]; downstream: StageRef[];
  references: { id: string; no: string; name: string; framework: string; status: string; source: string; markdown: string }[];
  trace: Trace | null;
};
export type Trace =
  | { kind: "stories_without_ac"; total: number; items: { id: string; text: string; release: string }[] }
  | { kind: "story_coverage"; total: number; items: { id: string; text: string; release: string; by: string[] }[] }
  | { kind: "ac_coverage"; total: number; counts: Record<string, number>; missing: string[] };
export type AuditRow = {
  id: number; at: string; stage_id: string | null; actor_type: string; actor: string; kind: string;
  target_version: number | null; body: Record<string, unknown> | null; reason: string | null;
};

export const STATUS_LABEL: Record<string, string> = {
  not_started: "未着手", in_progress: "作業中", awaiting_approval: "承認待ち", revising: "修正中",
  completed: "更新済み", skipped: "スキップ", needs_recheck: "要再確認",
};
