"use server";
import { revalidatePath } from "next/cache";
import { agent, AgentError } from "@/lib/agent";

type R = { error?: string; job_id?: string | null; thread?: number };
async function call(pid: string, path: string, method: string, body?: unknown): Promise<R> {
  try {
    const r = await agent<{ job_id?: string | null; thread?: number }>(`/products/${pid}${path}`, { method, body });
    revalidatePath(`/p/${pid}`, "layout");
    return { job_id: r?.job_id ?? null, thread: r?.thread };
  } catch (e) {
    if (e instanceof AgentError) return { error: e.message };
    throw e;
  }
}

export async function talkDirector(pid: string, text: string, thread?: number | null, attachments: number[] = []) {
  return call(pid, "/director/talk", "POST", { text, thread: thread ?? null, attachments });
}
export async function setReaders(pid: string, doc: number, readers: string[]) {
  return call(pid, `/imports/${doc}/readers`, "PUT", { readers });
}
export async function postBoard(pid: string, to: string, text: string, thread?: number | null, intent = "directive") {
  return call(pid, "/board", "POST", { to, text, thread: thread ?? null, intent });
}
export async function runTeam(pid: string, keys: string[] = []) { return call(pid, "/team/run", "POST", { keys }); }
export async function editTeamAgent(pid: string, key: string, body: { mission?: string; cron?: string; enabled?: boolean }) {
  return call(pid, `/team/${key}`, "PUT", body);
}
export async function saveTeamTask(pid: string, number: number | null, body: { agent?: string; title?: string; status?: string; owner?: string }) {
  return number ? call(pid, `/team/tasks/${number}`, "PUT", body) : call(pid, "/team/tasks", "POST", body);
}

export async function drawAvatars(keys: string[], redo: boolean): Promise<R> {
  try {
    await agent("/avatars/generate", { method: "POST", body: { keys, redo } });
    return {};
  } catch (e) {
    if (e instanceof AgentError) return { error: e.message };
    throw e;
  }
}
