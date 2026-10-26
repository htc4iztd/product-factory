import "server-only";
import { auth } from "./auth";

// agent-api への呼び出しは必ずサーバー側から行う。
// 呼び出し元の文脈（ユーザー・テナント・基本ロール）はセッションからだけ組み立てる。
const BASE = process.env.AGENT_API_URL ?? "http://localhost:8100";
const TOKEN = process.env.PF_INTERNAL_TOKEN ?? "dev-internal-token";
// Cloud Run では agent-api を IAM で閉じる。web のサービスアカウントの ID トークンを付けて呼ぶ。
export const ID_TOKEN = process.env.AGENT_AUTH === "google-id-token";

const idTokens = new Map<string, { value: string; exp: number }>();

// Cloud Run のメタデータサーバーから、audience 宛ての ID トークンを取る（IDE の中継でも使う）
export async function googleIdToken(audience: string = BASE): Promise<string> {
  const hit = idTokens.get(audience);
  if (hit && hit.exp > Date.now()) return hit.value;
  const url = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}`;
  const res = await fetch(url, { headers: { "Metadata-Flavor": "Google" }, cache: "no-store" });
  if (!res.ok) throw new AgentError(502, `ID トークンを取得できません（${res.status}）`);
  // トークンの有効期限は1時間。余裕を持って50分で取り直す
  const value = await res.text();
  idTokens.set(audience, { value, exp: Date.now() + 50 * 60 * 1000 });
  return value;
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

// ログインした人の文脈を持たない内部呼び出し（GitHub の webhook の中継など）。呼び出し元で正当性を確かめてから使う
export async function agentInternal<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json", "x-pf-internal-token": TOKEN,
      ...(ID_TOKEN ? { authorization: `Bearer ${await googleIdToken()}` } : {}),
    },
    body: JSON.stringify(body), cache: "no-store",
  });
  if (!res.ok) throw new AgentError(res.status, res.statusText);
  return (await res.json()) as T;
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
  cover_image_id: string | null; repo: string | null; repo_branch: string | null; created_at: string;
};
export type CanvasImage = { id: string; kind: string; note: string; prompt: string; model: string; base_id: string | null; created_by: string; created_at: string };
export type CanvasInfo = {
  product: Product; kinds: Record<string, string>; model: string;
  facts: { stage: string; label: string; value: string; source: string }[]; images: CanvasImage[];
};
export type Overview = { product: Product; phases: Phase[]; stages: StageSummary[] };

export type Column = { key: string; label: string; kind: "text" | "number"; options: string[] };
export type FieldSpec = {
  key: string; label: string; kind: "text" | "list" | "table" | "flows" | "er" | "states" | "specs" | "graph"; hint: string; required: boolean;
  columns: Column[]; rows: string[]; id_prefix: string;
};
export type Row = Record<string, string | number>;
export type FlowNode = { id: string; type: "start" | "task" | "decision" | "system" | "end"; label: string; lane: number; x: number };
export type FlowEdge = { id: string; source: string; target: string; label: string; sourceHandle?: string; targetHandle?: string };
export type Flow = { business: string; lanes: string[]; nodes: FlowNode[]; edges: FlowEdge[] };
// ⑨⑩の設計書の構造（designs.py と同じ形）
export type ErAttr = { name: string; physical: string; type: string; pk: boolean; fk: string; required: boolean; note: string };
export type ErEntity = { id: string; name: string; physical: string; note: string; attrs: ErAttr[]; x?: number; y?: number };
export type ErRelation = { id: string; source: string; target: string; card: "1:1" | "1:N" | "N:1" | "N:M"; label: string };
export type ErModel = { entities: ErEntity[]; relations: ErRelation[] };
export type SmState = { id: string; name: string; kind: "initial" | "normal" | "final"; note: string; x?: number; y?: number };
export type SmTransition = { id: string; source: string; target: string; event: string; guard: string; action: string };
export type StateMachine = { target: string; states: SmState[]; transitions: SmTransition[] };
export type SpecIo = { dir: string; kind: string; name: string; crud: string; format: string; note: string };
export type SpecParam = { dir: string; name: string; label: string; type: string; required: string; note: string };
export type SpecCall = { name: string; cls: string; method: string; args: string };
export type ProcSpec = {
  id: string; name: string; kind: string; component: string; trigger: string; fr: string; summary: string;
  steps: string[]; constraints: string; io: SpecIo[]; params: SpecParam[]; calls: SpecCall[]; settings: { key: string; note: string }[];
};
export type ArchNode = { id: string; label: string; kind: string; zone: string; note: string; x?: number; y?: number };
export type ArchEdge = { id: string; source: string; target: string; label: string };
export type ArchGraph = { nodes: ArchNode[]; edges: ArchEdge[] };
export type FieldValue = string | string[] | Row[] | Flow[] | ErModel | StateMachine[] | ProcSpec[] | ArchGraph;
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
  decisions: Decision[];
  autodev_targets: string[];
  variants: { number: number; key: string; title: string; status: PreProduct["status"] }[];
};
// プリプロダクト（案）の、あるステージの下書き
export type VariantStage = {
  number: number; key: string; title: string; concept: string; assumptions: string[]; status: PreProduct["status"];
  draft: Draft; markdown: string;
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

export type LlmProvider = "stub" | "gemini" | "vertex" | "anthropic" | "openai";
export type LlmView = {
  provider: LlmProvider; chat_model: string; summary_model: string; image_model: string;
  base_url: string | null; project: string | null; location: string | null;
  key_hint: string | null; has_key: boolean; allow_tenant_vertex: boolean; platform_granted: boolean; updated_by: string; updated_at: string | null;
};
export type LlmEffective = {
  provider: LlmProvider; provider_label: string; source: "tenant" | "app" | "env";
  chat_model: string; summary_model: string; image_model: string; base_url: string | null; location: string | null;
};
export type LlmSettings = {
  can_edit: boolean; is_admin: boolean; admin_configured: boolean; allow_tenant_vertex: boolean;
  tenant: LlmView | null; app: LlmView | null; effective: LlmEffective; app_effective: LlmEffective;
  options: {
    providers: Record<LlmProvider, string>;
    defaults: Record<LlmProvider, { chat: string; summary: string; image: string }>;
    suggested: Partial<Record<LlmProvider, string[]>>;
    needs_key: LlmProvider[]; image_providers: LlmProvider[];
    vertex_project: string | null; vertex_location: string;
  };
};
export type LlmTestResult = { ok: boolean; model: string; reply?: string; ms?: number; error?: string };

// ---------------- チーム ----------------
export type TicketStatus = "triage" | "todo" | "doing" | "review" | "done" | "closed";
export type Ticket = {
  number: number; key: string; title: string; body: string; status: TicketStatus; priority: "P1" | "P2" | "P3";
  assignee: string | null; stage_id: string | null; refs: string[]; due: string | null;
  source: { kind: string; id?: string | number; url?: string } | null; external: Record<string, unknown> | null;
  created_by: string; created_at: string; updated_at: string; comments?: number;
};
export type Post = {
  id: number; channel_id: string | null; parent_id: number | null; author: string; body: string; refs: string[];
  mentions: string[]; source: { provider?: string; url?: string | null } | null; created_at: string; replies?: number;
};
export type TicketDetail = Omit<Ticket, "comments"> & { comments: Post[] };
export type ChannelExternal = { provider: string; mode: "copy" | "summary"; ref: string; url: string };
export type Channel = { id: string; name: string; topic: string; external: ChannelExternal | null; posts: number; created_by: string; created_at: string };
export type Decision = {
  number: number; key: string; title: string; detail: string; rationale: string;
  status: "proposed" | "confirmed" | "rejected" | "superseded"; stage_id: string | null; refs: string[];
  source: { kind: string; id?: string | number; provider?: string; url?: string | null } | null;
  proposed_by: string; decided_by: string | null; decided_at: string | null; created_at: string;
};
export type Meeting = {
  number: number; key: string; title: string; starts_at: string | null; attendees: string[];
  source: { provider?: string; url?: string } | null; has_minutes: boolean; created_by: string; created_at: string;
};
export type MeetingDetail = Meeting & { agenda: string; transcript: string; minutes: string; decisions: Decision[]; tickets: Ticket[] };
export type DocSummary = { number: number; key: string; title: string; refs: string[]; updated_by: string; updated_at: string };
export type DocDetail = DocSummary & { body: string };
export type Notices = { unread: number; items: { id: number; kind: string; text: string; link: string; actor: string; read: boolean; product_id: string; created_at: string }[] };

export type GithubLink = { repo: string; number: number; url: string; state: string; synced_at: string; error: string | null };
export type GithubStatus = {
  repo: string | null; sync: "off" | "build" | "all"; import: boolean; synced_at: string | null;
  token: { source: "tenant" | "server" | "none"; hint: string | null };
};
export type GithubToken = { source: "tenant" | "server" | "none"; hint: string | null; can_edit: boolean };

// ---------------- ジョブとプリプロダクト ----------------
export type JobUsage = { calls: number; input_tokens: number; output_tokens: number; by_model: Record<string, { calls: number; input_tokens: number; output_tokens: number }> };
export type JobRun = {
  id: string; kind: string; name: string; product_id: string | null; params: Record<string, unknown>;
  status: "queued" | "running" | "done" | "failed" | "cancelled"; progress: { done: number; total: number; step: string } | null;
  usage: JobUsage | null; runner: "cloud-run-job" | "thread"; execution: string | null; error: string | null; model: string;
  retry_of: string | null; cancel_requested: boolean; created_by: string; created_at: string; started_at: string | null;
  finished_at: string | null; seconds: number | null; log?: { at: string; step: string }[]; tasks: JobTask[];
};
export type JobTaskStatus = "pending" | "running" | "done" | "failed" | "skipped" | "cancelled";
export type JobTask = {
  id: string; name: string; group: string; deps: string[]; status: JobTaskStatus;
  started_at: string | null; finished_at: string | null; error: string | null; detail: string;
  usage: { calls: number; input_tokens: number; output_tokens: number } | null;
};
export type JobDef = {
  kind: string; name: string; description: string; trigger: string; timeout_min: number; status: "available" | "planned";
  runner: string; cloud_run_job: string | null; region: string | null; runs: number; running: number; failed: number; tokens: number;
};
export type PreProduct = {
  number: number; key: string; job_id: string; title: string; concept: string; assumptions: string[];
  status: "generating" | "ready" | "failed" | "adopted"; error: string | null; stages: string[]; has_prototype: boolean;
  adopted_by: string | null; adopted_at: string | null; created_at: string;
};
export type PreProductDetail = PreProduct & { markdown: Record<string, string>; job: JobRun };
export type AutodevRun = JobRun & { upstream_changed: string[]; pre_products: PreProduct[] };

// ---------------- 社内のオントロジー ----------------
export type Concept = {
  id: number; label: string; kind: string; definition: string; aliases: string[]; examples: string[];
  status: "active" | "proposed"; source: string | null; updated_by: string; updated_at: string | null;
};
export type ConceptRelation = { id: number; source: number; target: number; type: string; note: string };
export type Ontology = { concepts: Concept[]; relations: ConceptRelation[]; kinds: Record<string, string>; relation_types: Record<string, string> };

// ---------------- リサーチライブラリ ----------------
export type ResearchLibrary = {
  id: number; number: number; key: string; name: string; description: string; instructions: string; use_search: boolean;
  feeds: string[]; sites: string[]; issues: string[]; entities: string[]; since: string | null; latest: string | null;
  issue_defs: Record<string, string>; layers: string[]; topics: string[];
  updated_at: string | null; created_by: string; articles?: number; facts?: number;
};
export type ResearchArticle = {
  id: number; number: number; key: string; url: string; title: string; publisher: string; published: string | null;
  region: string; category: string; summary: string; issues: string[]; entities: string[]; checked: boolean;
  title_ja: string; country: string;
  origin: string; memo: string; added_at: string;
};
export type ResearchFact = {
  number: number; key: string; date: string | null; kind: string; theme: string; metric: string; value: string; scope: string;
  source: string; quote: string; verified: boolean; article: string; url: string; title: string; region: string; publisher: string;
};
export type ResearchNote = { id: number; title: string; body: string; filters: Record<string, string>; created_by: string; created_at: string };
export type ResearchDetail = ResearchLibrary & {
  items: ResearchArticle[]; facts: ResearchFact[];
  issue_notes: Record<string, { body: string; data: IssueData | null; articles: number; created_at: string }>;
  analyses: ResearchNote[];
  stats: {
    articles: number; facts: number; by_month: [string, number][]; by_issue: [string, number][]; by_entity: [string, number][];
    by_category: [string, number][]; by_region: [string, number][]; by_fact_kind: [string, number][];
  };
  options: { regions: Record<string, string>; categories: Record<string, string>; fact_kinds: Record<string, string> };
};

export type IssueData = {
  headline: string; claims: { text: string; stance: string; refs: number[] }[];
  counter: string; counter_refs: number[]; domestic: string; domestic_refs: number[]; shift: string;
};
export type ResearchPlayer = {
  id: number; name: string; aliases: string[]; layer: string; region: string; role: string; detail: string; stance: string;
  tags: string[]; latest: { d: string; text: string; u: string; article?: string } | null; updated_by: string;
};
export type ResearchQuestion = {
  id: number; question: string; state: "pending" | "running" | "answered" | "error"; answer: string;
  basis: "" | "article" | "search" | "none"; sources: { u: string; t: string }[]; message: string; job_id: string | null;
  asked_by: string; asked_at: string; answered_at: string | null;
};
export type ResearchReport = {
  id: number; number: number; key: string; kind: "tech" | "industry" | "public"; title: string; instructions: string;
  status: "queued" | "running" | "done" | "failed"; data: Record<string, unknown> | null; sources: { u: string; t: string }[];
  basis: "" | "search" | "knowledge" | "stub"; error: string; checked: string | null; job_id: string | null;
  created_by: string; created_at: string;
};
export type ResearchData = ResearchDetail & {
  players: ResearchPlayer[]; questions: Record<string, ResearchQuestion[]>; reports: ResearchReport[];
};
