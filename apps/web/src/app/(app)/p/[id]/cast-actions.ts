"use server";
import { revalidatePath } from "next/cache";
import { agent, AgentError } from "@/lib/agent";

type R = { error?: string };
async function call(pid: string, path: string, method: string, body?: unknown): Promise<R> {
  try {
    await agent(path, { method, body });
    revalidatePath(`/p/${pid}/cast`);
    return {};
  } catch (e) {
    if (e instanceof AgentError) return { error: e.message };
    throw e;
  }
}

// ペルソナ・スキル・ツールの割り当て（テナントで共通。管理者だけ）
export async function saveProfile(pid: string, key: string, body: { persona?: Record<string, string>; skills?: string[]; tools?: string[]; reset?: boolean }) {
  return call(pid, `/agent-profiles/${key}`, "PUT", body);
}
export async function saveSkill(pid: string, id: string, body: { name: string; kind: string; description: string; refs: string[]; tools: string[]; prefetch: string[]; body: string }) {
  return call(pid, `/skills/${encodeURIComponent(id)}`, "PUT", body);
}
export async function deleteSkill(pid: string, id: string) { return call(pid, `/skills/${encodeURIComponent(id)}`, "DELETE"); }
