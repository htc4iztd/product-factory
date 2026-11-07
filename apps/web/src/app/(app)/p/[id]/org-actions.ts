"use server";
import { revalidatePath } from "next/cache";
import { agent, AgentError } from "@/lib/agent";

type R = { error?: string; job_id?: string | null; issues?: number[]; number?: number; id?: number };
async function call(pid: string, path: string, method: string, body?: unknown): Promise<R> {
  try {
    const r = await agent<Record<string, unknown>>(`/products/${pid}${path}`, { method, body });
    revalidatePath(`/p/${pid}`, "layout");
    return { job_id: (r?.job_id as string) ?? null, issues: r?.issues as number[], number: r?.number as number, id: r?.id as number };
  } catch (e) {
    if (e instanceof AgentError) return { error: e.message };
    throw e;
  }
}

// PdM が話せるのは PM だけ
export async function talkPm(pid: string, pm: string, text: string, opts: { stage_id?: string | null; meeting_id?: number | null; attachments?: number[] } = {}) {
  return call(pid, `/pm/${pm}/talk`, "POST", { text, stage_id: opts.stage_id ?? null, meeting_id: opts.meeting_id ?? null, attachments: opts.attachments ?? [] });
}
export async function runTeam(pid: string, keys: string[] = []) { return call(pid, "/team/run", "POST", { keys }); }
export async function editTeamAgent(pid: string, key: string, body: { mission?: string; cron?: string; enabled?: boolean }) {
  return call(pid, `/team/${key}`, "PUT", body);
}
export async function createIssue(pid: string, body: { assignee: string; subject: string; description: string; tracker: string; priority: string; due_date?: string | null }) {
  return call(pid, "/issues", "POST", body);
}
export async function updateIssue(pid: string, n: number, body: { notes?: string; status?: string; priority?: string; assignee?: string }) {
  return call(pid, `/issues/${n}`, "PUT", body);
}
export async function setReaders(pid: string, doc: number, readers: string[]) {
  return call(pid, `/imports/${doc}/readers`, "PUT", { readers });
}
export async function setDocReaders(pid: string, doc: number, readers: string[]) {
  return call(pid, `/docs/${doc}/readers`, "PUT", { readers });
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

// プラットフォーム（プロダクトごと。そのプロダクトの稼働を見張る）：PdM が直接話す。対処は PdM が承認したものだけ実行する
async function platformCall(pid: string, path: string, method: string, body?: unknown): Promise<R & { done?: string }> {
  try {
    const r = await agent<Record<string, unknown>>(`/products/${pid}/platform${path}`, { method, body });
    revalidatePath(`/p/${pid}`, "layout");
    return { done: r?.done as string };
  } catch (e) {
    if (e instanceof AgentError) return { error: e.message };
    throw e;
  }
}
export async function talkPlatform(pid: string, text: string) { return platformCall(pid, "/talk", "POST", { text }); }
export async function actPlatform(pid: string, findingId: number) { return platformCall(pid, `/findings/${findingId}/act`, "POST"); }
export async function setPlatformFinding(pid: string, findingId: number, status: "open" | "ack" | "resolved") {
  return platformCall(pid, `/findings/${findingId}`, "PUT", { status });
}

// 定期実行の予定：読み方と次の3回を確かめる・まとめて変える・プラットフォームの見回りの間隔
export async function previewSchedule(cron: string): Promise<{ error?: string; label?: string; next?: string[]; warning?: string }> {
  try {
    return await agent<{ label: string; next: string[]; warning: string }>("/schedule/preview", { method: "POST", body: { cron } });
  } catch (e) {
    if (e instanceof AgentError) return { error: e.message };
    throw e;
  }
}
export async function saveSchedule(pid: string, keys: string[], body: { cron?: string; enabled?: boolean }) {
  return call(pid, "/schedule", "PUT", { keys, ...body });
}
// 全エージェントの定期実行を一時停止する／再開する（このプロダクトだけ）
export async function pauseSchedule(pid: string, paused: boolean) {
  return call(pid, "/schedule/pause", "PUT", { paused });
}
export async function setPlatformEvery(pid: string, every_min: number): Promise<R> {
  try {
    await agent("/platform/schedule", { method: "PUT", body: { every_min } });
    revalidatePath(`/p/${pid}`, "layout");
    return {};
  } catch (e) {
    if (e instanceof AgentError) return { error: e.message };
    throw e;
  }
}

// ダッシュボードで案を承認・否認する（まとめて）
export async function decideApprovals(pid: string, keys: string[], accept: boolean): Promise<R & { done?: string[]; failed?: string[] }> {
  try {
    const r = await agent<{ done: string[]; failed: string[] }>(`/products/${pid}/approvals`, { method: "POST", body: { keys, accept } });
    revalidatePath(`/p/${pid}`, "layout");
    return { done: r.done, failed: r.failed };
  } catch (e) {
    if (e instanceof AgentError) return { error: e.message };
    throw e;
  }
}
