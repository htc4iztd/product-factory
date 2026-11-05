"use server";
import { agent, AgentError } from "@/lib/agent";

export type WsCommit = { number: number; author: string; unit: string; message: string; files: { path: string; op: "add" | "modify" | "delete"; lines: [number, number] }[]; source: string; github_sha: string | null; at: string | null; patch?: string };
export type WsUnit = { id: string; name: string; scope: string; done_when: string; commits: number; last: number | null };
export type WsSync = { status: "off" | "ok" | "pending" | "diverged" | "error"; repo: string; branch: string; remote_sha: string; error: string; at: string | null; unpushed: number };
export type WsView = { units: WsUnit[]; commits: WsCommit[]; files: number; sync: WsSync; repo: string | null; branch: string | null };

// 作業場の変更を、いま GitHub に送る／GitHub の変更を作業場に取り込む
export async function pushWorkspace(pid: string): Promise<{ error?: string }> {
  try { await agent(`/products/${pid}/workspace/push`, { method: "POST" }); return {}; } catch (e) { if (e instanceof AgentError) return { error: e.message }; throw e; }
}
// GitHub で直接された変更を戻す：GitHub を作業場の内容で上書きする（履歴は重ねる・強制プッシュはしない）
export async function overwriteWorkspace(pid: string): Promise<{ error?: string }> {
  try { await agent(`/products/${pid}/workspace/push?overwrite=true`, { method: "POST" }); return {}; } catch (e) { if (e instanceof AgentError) return { error: e.message }; throw e; }
}
export async function importWorkspace(pid: string): Promise<{ error?: string }> {
  try { await agent(`/products/${pid}/workspace/import`, { method: "POST" }); return {}; } catch (e) { if (e instanceof AgentError) return { error: e.message }; throw e; }
}
