"use server";
import { revalidatePath } from "next/cache";
import { agent, AgentError, type LlmTestResult } from "@/lib/agent";

export type LlmForm = {
  provider: string; chat_model: string; summary_model: string; image_model: string;
  base_url: string; project: string; location: string; api_key: string; clear_key: boolean; allow_tenant_vertex: boolean;
};

export async function saveLlm(scope: "tenant" | "app", form: LlmForm): Promise<{ error?: string }> {
  try {
    await agent(`/settings/llm/${scope}`, { method: "PUT", body: { ...form, base_url: form.base_url || null } });
  } catch (e) {
    if (e instanceof AgentError) return { error: e.message };
    throw e;
  }
  revalidatePath("/settings");
  return {};
}

export async function testLlm(scope: "tenant" | "app", model?: string): Promise<LlmTestResult> {
  try {
    return await agent<LlmTestResult>("/settings/llm/test", { method: "POST", body: { scope, model: model ?? null } });
  } catch (e) {
    if (e instanceof AgentError) return { ok: false, model: "", error: e.message };
    throw e;
  }
}

export async function listLlmModels(scope: "tenant" | "app"): Promise<{ ok: boolean; models: string[]; error?: string }> {
  try {
    return await agent("/settings/llm/models", { method: "POST", body: { scope } });
  } catch (e) {
    if (e instanceof AgentError) return { ok: false, models: [], error: e.message };
    throw e;
  }
}

export async function saveGithubToken(token: string | null): Promise<{ error?: string }> {
  try {
    await agent("/settings/github", { method: "PUT", body: { token } });
  } catch (e) {
    if (e instanceof AgentError) return { error: e.message };
    throw e;
  }
  revalidatePath("/settings");
  return {};
}

export async function testGithub(): Promise<{ ok: boolean; login?: string; source?: string; error?: string }> {
  try {
    return await agent("/settings/github/test", { method: "POST" });
  } catch (e) {
    if (e instanceof AgentError) return { ok: false, error: e.message };
    throw e;
  }
}
