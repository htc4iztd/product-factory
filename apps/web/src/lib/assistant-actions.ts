"use server";
import { revalidatePath } from "next/cache";
import { agent, AgentError, type AssistantMsg, type MentionT } from "@/lib/agent";

// チャットに話す・承認依頼に答える
export async function sendAssistant(path: string, text: string, mentions: MentionT[], attachments: number[], material = ""): Promise<{ error?: string; reply?: AssistantMsg }> {
  try {
    const r = await agent<{ reply: AssistantMsg }>("/assistant/messages", { method: "POST", body: { path, text, mentions, attachments, material } });
    return { reply: r.reply };
  } catch (e) {
    if (e instanceof AgentError) return { error: e.message };
    throw e;
  }
}

export async function decideAssistant(messageId: number, actionId: string, approve: boolean): Promise<{ error?: string; message?: AssistantMsg }> {
  try {
    const m = await agent<AssistantMsg>(`/assistant/messages/${messageId}/actions/${actionId}`, { method: "POST", body: { approve } });
    revalidatePath("/", "layout");
    return { message: m };
  } catch (e) {
    if (e instanceof AgentError) return { error: e.message };
    throw e;
  }
}

// リサーチライブラリのまとめ（チャットに添える材料）
export async function researchBrief(n: number, issue: string): Promise<{ error?: string; brief?: string }> {
  try {
    const { brief } = await agent<{ brief: string }>(`/research/${n}/brief${issue ? `?issue=${encodeURIComponent(issue)}` : ""}`);
    return { brief: brief.slice(0, 38000) };
  } catch (e) {
    if (e instanceof AgentError) return { error: e.message };
    throw e;
  }
}
