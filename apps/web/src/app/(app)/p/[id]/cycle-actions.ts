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

export async function startNextCycle(pid: string, body: { strategy: string; directives: Record<string, string>; notes: string }): Promise<{ error?: string; job_id?: string }> {
  try {
    const r = await agent<{ job_id: string }>(`/products/${pid}/review/next`, { method: "POST", body });
    revalidatePath(`/p/${pid}`, "layout");
    return { job_id: r.job_id };
  } catch (e) {
    if (e instanceof AgentError) return { error: e.message };
    throw e;
  }
}
