"use server";
import { revalidatePath } from "next/cache";
import { agent, AgentError, type FieldValue, type StageDetail } from "@/lib/agent";

export type Result = { error?: string };

async function call(pid: string, path: string, method: string, body?: unknown): Promise<Result> {
  try {
    await agent<StageDetail>(`/products/${pid}${path}`, { method, body });
  } catch (e) {
    if (e instanceof AgentError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/p/${pid}`, "layout");
  return {};
}

export async function sendChat(pid: string, sid: string, message: string, sessionId: string | null, attachments: number[] = []) {
  return call(pid, `/stages/${sid}/chat`, "POST", { message, session_id: sessionId, attachments });
}

export async function newSession(pid: string, sid: string, title: string): Promise<Result & { sessionId?: string }> {
  try {
    const st = await agent<StageDetail>(`/products/${pid}/stages/${sid}/sessions`, { method: "POST", body: { title } });
    revalidatePath(`/p/${pid}`, "layout");
    return { sessionId: st.session_id ?? undefined };
  } catch (e) {
    if (e instanceof AgentError) return { error: e.message };
    throw e;
  }
}

export async function renameSession(pid: string, sid: string, sessionId: string, title: string) {
  return call(pid, `/stages/${sid}/sessions/${sessionId}`, "PUT", { title });
}

export async function makeReport(pid: string, sid: string) {
  return call(pid, `/stages/${sid}/report`, "POST");
}

export async function decideProposal(pid: string, sid: string, messageId: number, proposalId: string, accept: boolean) {
  return call(pid, `/stages/${sid}/proposals`, "POST", { message_id: messageId, proposal_id: proposalId, accept });
}

export async function acceptAll(pid: string, sid: string, messageId: number, proposalIds: string[]) {
  for (const id of proposalIds) {
    const r = await call(pid, `/stages/${sid}/proposals`, "POST", { message_id: messageId, proposal_id: id, accept: true });
    if (r.error) return r;
  }
  return {};
}

export async function setField(pid: string, sid: string, field: string, value: FieldValue) {
  return call(pid, `/stages/${sid}/draft`, "PUT", { field, value });
}

export async function commit(pid: string, sid: string, note: string, force: boolean) {
  return call(pid, `/stages/${sid}/commit`, "POST", { note, force });
}

export async function acknowledge(pid: string, sid: string) {
  return call(pid, `/stages/${sid}/ack`, "POST");
}

export async function decide(pid: string, sid: string, decision: string, comment: string) {
  return call(pid, `/stages/${sid}/decide`, "POST", { decision, comment });
}

export async function setStage(pid: string, sid: string, cfg: { enabled?: boolean; approval_required?: boolean }) {
  return call(pid, `/settings`, "PUT", { stages: { [sid]: cfg } });
}

export async function setMarkdown(pid: string, sid: string, markdown: string): Promise<Result & { changed?: string[]; notes?: string[] }> {
  try {
    const r = await agent<{ changed: string[]; notes: string[] }>(`/products/${pid}/stages/${sid}/markdown`, { method: "PUT", body: { markdown } });
    revalidatePath(`/p/${pid}`, "layout");
    return { changed: r.changed, notes: r.notes };
  } catch (e) {
    if (e instanceof AgentError) return { error: e.message };
    throw e;
  }
}

export async function importAcceptance(pid: string) {
  return call(pid, `/stages/s13/import-acceptance`, "POST");
}
