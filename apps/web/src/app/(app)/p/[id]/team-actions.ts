"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { agent, AgentError, type Decision, type DocDetail, type Meeting, type Post, type Ticket } from "@/lib/agent";

type Result = { error?: string };
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const opt = (f: FormData, k: string) => str(f, k) || null;

async function run<T>(fn: () => Promise<T>): Promise<{ ok: T } | { error: string }> {
  try {
    return { ok: await fn() };
  } catch (e) {
    if (e instanceof AgentError) return { error: e.message };
    throw e;
  }
}

// ---------------- チケット ----------------
export async function createTicket(pid: string, _: Result | undefined, f: FormData): Promise<Result> {
  const r = await run(() => agent<Ticket>(`/products/${pid}/tickets`, { method: "POST", body: {
    title: str(f, "title"), body: str(f, "body"), priority: str(f, "priority") || "P2", status: str(f, "status") || "todo",
    assignee: opt(f, "assignee"), stage_id: opt(f, "stage_id"), due: opt(f, "due"),
  } }));
  if ("error" in r) return r;
  redirect(`/p/${pid}/tickets/${r.ok.number}`);
}

export async function updateTicket(pid: string, n: number, patch: Partial<Ticket>): Promise<Result> {
  const r = await run(() => agent(`/products/${pid}/tickets/${n}`, { method: "PATCH", body: patch }));
  if ("error" in r) return r;
  revalidatePath(`/p/${pid}/tickets`, "layout");
  return {};
}

export async function commentTicket(pid: string, n: number, _: Result | undefined, f: FormData): Promise<Result> {
  const r = await run(() => agent<Post>(`/products/${pid}/tickets/${n}/comments`, { method: "POST", body: { body: str(f, "body") } }));
  if ("error" in r) return r;
  revalidatePath(`/p/${pid}/tickets/${n}`);
  return {};
}

// ---------------- チャンネル ----------------
export async function createChannel(pid: string, _: Result | undefined, f: FormData): Promise<Result> {
  const provider = str(f, "provider");
  const r = await run(() => agent<{ id: string }>(`/products/${pid}/channels`, { method: "POST", body: {
    name: str(f, "name"), topic: str(f, "topic"),
    external: provider ? { provider, mode: str(f, "mode") || "summary", url: str(f, "url") } : null,
  } }));
  if ("error" in r) return r;
  redirect(`/p/${pid}/talk?c=${r.ok.id}`);
}

export async function postMessage(pid: string, cid: string, parent: number | null, _: Result | undefined, f: FormData): Promise<Result> {
  const r = await run(() => agent(`/products/${pid}/channels/${cid}/posts`, { method: "POST", body: { body: str(f, "body"), parent_id: parent } }));
  if ("error" in r) return r;
  revalidatePath(`/p/${pid}/talk`);
  return {};
}

// 外部の会話を貼り付けて取り込む。1行が1発言で、「名前: 本文」なら名前を発言者にする
export async function importPosts(pid: string, cid: string, _: Result | undefined, f: FormData): Promise<Result> {
  const items = str(f, "text").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = /^([^:：]{1,60})[:：]\s*(.+)$/.exec(l);
    return m ? { author: m[1].trim(), body: m[2] } : { author: "", body: l };
  });
  const r = await run(() => agent(`/products/${pid}/channels/${cid}/import`, { method: "POST", body: { items } }));
  if ("error" in r) return r;
  revalidatePath(`/p/${pid}/talk`);
  revalidatePath(`/p/${pid}/decisions`);
  return {};
}

export async function extractThread(pid: string, postId: number): Promise<Result & { decisions?: number; tickets?: number }> {
  const r = await run(() => agent<{ decisions: Decision[]; tickets: Ticket[] }>(`/products/${pid}/threads/${postId}/extract`, { method: "POST" }));
  if ("error" in r) return r;
  revalidatePath(`/p/${pid}/talk`);
  return { decisions: r.ok.decisions.length, tickets: r.ok.tickets.length };
}

// ---------------- 決定記録 ----------------
export async function createDecision(pid: string, _: Result | undefined, f: FormData): Promise<Result> {
  const r = await run(() => agent(`/products/${pid}/decisions`, { method: "POST", body: {
    title: str(f, "title"), detail: str(f, "detail"), rationale: str(f, "rationale"), stage_id: opt(f, "stage_id"),
    confirmed: f.get("confirmed") === "on",
  } }));
  if ("error" in r) return r;
  revalidatePath(`/p/${pid}/decisions`);
  return {};
}

export async function decide(pid: string, n: number, _: Result | undefined, f: FormData): Promise<Result> {
  const r = await run(() => agent(`/products/${pid}/decisions/${n}/decide`, { method: "POST", body: {
    status: str(f, "status"), stage_id: opt(f, "stage_id"), create_ticket: f.get("create_ticket") === "on",
  } }));
  if ("error" in r) return r;
  revalidatePath(`/p/${pid}`, "layout");
  return {};
}

// ---------------- 会議 ----------------
export async function createMeeting(pid: string, _: Result | undefined, f: FormData): Promise<Result> {
  const r = await run(() => agent<Meeting>(`/products/${pid}/meetings`, { method: "POST", body: {
    title: str(f, "title"), starts_at: opt(f, "starts_at"),
    attendees: str(f, "attendees").split(/[,、\s]+/).filter(Boolean),
    source: str(f, "provider") ? { provider: str(f, "provider"), url: str(f, "url") } : null,
  } }));
  if ("error" in r) return r;
  redirect(`/p/${pid}/meetings/${r.ok.number}`);
}

export async function saveMeeting(pid: string, n: number, _: Result | undefined, f: FormData): Promise<Result> {
  const r = await run(() => agent(`/products/${pid}/meetings/${n}`, { method: "PUT", body: {
    title: str(f, "title"), starts_at: str(f, "starts_at"), agenda: String(f.get("agenda") ?? ""),
    transcript: String(f.get("transcript") ?? ""), attendees: str(f, "attendees").split(/[,、\s]+/).filter(Boolean),
  } }));
  if ("error" in r) return r;
  if (f.get("minutes") === "1") {
    const m = await run(() => agent(`/products/${pid}/meetings/${n}/minutes`, { method: "POST" }));
    if ("error" in m) return m;
  }
  revalidatePath(`/p/${pid}/meetings/${n}`);
  return {};
}

// ---------------- ドキュメント ----------------
export async function createDoc(pid: string, _: Result | undefined, f: FormData): Promise<Result> {
  const r = await run(() => agent<DocDetail>(`/products/${pid}/docs`, { method: "POST", body: { title: str(f, "title"), body: "" } }));
  if ("error" in r) return r;
  redirect(`/p/${pid}/docs/${r.ok.number}`);
}

export async function saveDoc(pid: string, n: number, title: string, body: string): Promise<Result> {
  const r = await run(() => agent(`/products/${pid}/docs/${n}`, { method: "PUT", body: { title, body } }));
  if ("error" in r) return r;
  revalidatePath(`/p/${pid}/docs`, "layout");
  return {};
}

export async function readNotices(): Promise<void> {
  await agent("/notices/read", { method: "POST" });
  revalidatePath("/notices");
}

// ---------------- GitHub Issues との同期 ----------------
export async function configureGithub(pid: string, sync: string, importNew: boolean): Promise<Result> {
  const r = await run(() => agent(`/products/${pid}/github`, { method: "PUT", body: { sync, import_new: importNew } }));
  if ("error" in r) return r;
  revalidatePath(`/p/${pid}/tickets`, "layout");
  return {};
}

export async function syncGithub(pid: string): Promise<Result & { updated?: number; created?: number; comments?: number }> {
  const r = await run(() => agent<{ updated: number; created: number; comments: number }>(`/products/${pid}/github/sync`, { method: "POST" }));
  if ("error" in r) return r;
  revalidatePath(`/p/${pid}/tickets`, "layout");
  return r.ok;
}

export async function pushTicket(pid: string, n: number): Promise<Result> {
  const r = await run(() => agent(`/products/${pid}/tickets/${n}/github`, { method: "POST" }));
  if ("error" in r) return r;
  revalidatePath(`/p/${pid}/tickets`, "layout");
  return {};
}
