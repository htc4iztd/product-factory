"use server";
import { agent, AgentError } from "@/lib/agent";

export type ConsultNote = { id: number; text: string; by: string; msg_id: number | null; at: string | null };
export type ConsultView = {
  stage: { id: string; no: string; name: string }; agent: { key: string; name: string };
  knowledge: string[]; notes: ConsultNote[]; thread: import("@/lib/agent").AssistantMsg[];
};

async function run<T>(fn: () => Promise<T>): Promise<{ error?: string; data?: T }> {
  try { return { data: await fn() }; } catch (e) { if (e instanceof AgentError) return { error: e.message }; throw e; }
}

// 合意メモを手で足す・消す
export async function addConsultNote(pid: string, sid: string, text: string) {
  return run(() => agent<ConsultNote>(`/products/${pid}/stages/${sid}/consult/notes`, { method: "POST", body: { text } }));
}
export async function dropConsultNote(pid: string, sid: string, id: number) {
  return run(() => agent(`/products/${pid}/stages/${sid}/consult/notes/${id}`, { method: "DELETE" }));
}
