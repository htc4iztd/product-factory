"use server";
import { revalidatePath } from "next/cache";
import { agent, AgentError } from "@/lib/agent";

async function run(pid: string, path: string, method: string, body?: unknown): Promise<{ error?: string }> {
  try {
    await agent(`/products/${pid}${path}`, { method, body });
  } catch (e) {
    if (e instanceof AgentError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/p/${pid}`, "layout");
  return {};
}

export async function generateImage(pid: string, kind: string, note: string) {
  return run(pid, "/images", "POST", { kind, note });
}

export async function setCover(pid: string, imageId: string | null) {
  return run(pid, "/cover", "PUT", { image_id: imageId });
}

export async function deleteImage(pid: string, imageId: string) {
  return run(pid, `/images/${imageId}`, "DELETE");
}
