"use server";
import { revalidatePath } from "next/cache";
import { agent, AgentError } from "@/lib/agent";

export type ProtoComment = {
  id: string; target: string; label: string; text: string; status: "open" | "sent" | "applied" | "resolved";
  x: number; y: number; by: string; at: string; msg_id: number | null; context: string;
};
export type Proto = { html: string; comments: ProtoComment[]; source: string; at: string };

// ⑥のプロトタイプ（1つの HTML）とコメントを保存する。渡さなかったものはそのまま
export async function saveProto(pid: string, body: { html?: string; comments?: ProtoComment[]; source?: string }): Promise<{ error?: string; proto?: Proto }> {
  try {
    const proto = await agent<Proto>(`/products/${pid}/ui/proto`, { method: "PUT", body });
    revalidatePath(`/p/${pid}/s/s06`, "layout");
    return { proto };
  } catch (e) {
    if (e instanceof AgentError) return { error: e.message };
    throw e;
  }
}

// AI にプロトタイプを書かせる（ジョブ）。できたら設計PM がチャットで承認依頼を出す
export async function generateProto(pid: string, note: string): Promise<{ error?: string; job?: string }> {
  try {
    const j = await agent<{ id: string }>(`/products/${pid}/ui/proto/generate`, { method: "POST", body: { note } });
    return { job: j.id };
  } catch (e) {
    if (e instanceof AgentError) return { error: e.message };
    throw e;
  }
}
