"use server";
import { revalidatePath } from "next/cache";
import { agent, AgentError, type GithubSyncMany, type GithubSyncOne } from "@/lib/agent";

// GitHub Issues との同期（人が押したときだけ動く）
export async function syncIssueGithub(pid: string, n: number): Promise<{ result?: GithubSyncOne; error?: string }> {
  try {
    const result = await agent<GithubSyncOne>(`/products/${pid}/issues/${n}/github`, { method: "POST" });
    revalidatePath(`/p/${pid}/issues`, "layout");
    return { result };
  } catch (e) {
    if (e instanceof AgentError) return { error: e.message };
    throw e;
  }
}

export async function syncAllGithub(pid: string, includeOpen: boolean): Promise<{ result?: GithubSyncMany; error?: string }> {
  try {
    const result = await agent<GithubSyncMany>(`/products/${pid}/github/sync`, { method: "POST", body: { include_open: includeOpen } });
    revalidatePath(`/p/${pid}/issues`, "layout");
    return { result };
  } catch (e) {
    if (e instanceof AgentError) return { error: e.message };
    throw e;
  }
}
