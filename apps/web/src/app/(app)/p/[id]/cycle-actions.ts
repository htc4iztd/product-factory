"use server";
import { revalidatePath } from "next/cache";
import { agent, AgentError } from "@/lib/agent";

// プロダクトレビュー：始める・次のサイクルを始める
export async function startReview(pid: string): Promise<{ error?: string }> {
  try {
    await agent(`/products/${pid}/review/start`, { method: "POST" });
    revalidatePath(`/p/${pid}`, "layout");
    return {};
  } catch (e) {
    if (e instanceof AgentError) return { error: e.message };
    throw e;
  }
}

export async function saveCyclePlan(pid: string, items: { label: string; purpose: string; exit: string }[]): Promise<{ error?: string }> {
  try {
    await agent(`/products/${pid}/cycle-plan`, { method: "PUT", body: { items } });
    revalidatePath(`/p/${pid}`, "layout");
    return {};
  } catch (e) {
    if (e instanceof AgentError) return { error: e.message };
    throw e;
  }
}

export async function startNextCycle(pid: string, body: { strategy: string; directives: Record<string, string>; notes: string; label?: string }): Promise<{ error?: string; job_id?: string }> {
  try {
    const r = await agent<{ job_id: string }>(`/products/${pid}/review/next`, { method: "POST", body });
    revalidatePath(`/p/${pid}`, "layout");
    return { job_id: r.job_id };
  } catch (e) {
    if (e instanceof AgentError) return { error: e.message };
    throw e;
  }
}

async function post(pid: string, path: string, method: string, body?: unknown): Promise<{ error?: string }> {
  try {
    await agent(`/products/${pid}${path}`, { method, body });
    revalidatePath(`/p/${pid}`, "layout");
    return {};
  } catch (e) {
    if (e instanceof AgentError) return { error: e.message };
    throw e;
  }
}

// プロダクトレビューの回：PM に修正を指示する・もう一度レビューさせる・完了する
export async function reviewFix(pid: string, notes: string, directives: Record<string, string>) { return post(pid, "/review/fix", "POST", { notes, directives }); }
export async function reviewAgain(pid: string) { return post(pid, "/review/again", "POST"); }
export async function reviewComplete(pid: string, next: "release" | "skip") { return post(pid, "/review/complete", "POST", { next }); }

// リリース
export async function saveReleaseTarget(pid: string, body: Record<string, unknown>) { return post(pid, "/release/target", "PUT", body); }
export async function saveReleaseSecret(pid: string, secret: string | null) { return post(pid, "/release/secret", "PUT", { secret }); }
export async function approveRelease(pid: string) { return post(pid, "/release/approve", "POST"); }
export async function requestReleaseChanges(pid: string, feedback: string) { return post(pid, "/release/changes", "POST", { feedback }); }
export async function finishManualRelease(pid: string, ok: boolean, note: string) { return post(pid, "/release/manual", "POST", { ok, note }); }
