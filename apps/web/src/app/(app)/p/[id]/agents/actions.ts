"use server";
import { revalidatePath } from "next/cache";
import { agent, AgentError } from "@/lib/agent";

type R = { error?: string };
async function call(pid: string, path: string, method: string, body?: unknown): Promise<R> {
  try {
    await agent(`/products/${pid}${path}`, { method, body });
  } catch (e) {
    if (e instanceof AgentError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/p/${pid}/agents`);
  return {};
}

export async function saveAgent(pid: string, n: number | null, body: Record<string, unknown>) {
  return n ? call(pid, `/agents/${n}`, "PUT", body) : call(pid, "/agents", "POST", body);
}
export async function runAgent(pid: string, n: number) { return call(pid, `/agents/${n}/run`, "POST"); }
export async function deleteAgent(pid: string, n: number) { return call(pid, `/agents/${n}`, "DELETE"); }
export async function decideFinding(pid: string, id: number, action: string, picks?: number[], reason = "") {
  return call(pid, `/agent-findings/${id}/decide`, "POST", { action, picks, reason });
}
export async function replyFinding(pid: string, id: number, text: string) {
  return call(pid, `/agent-findings/${id}/reply`, "POST", { text });
}
