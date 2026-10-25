"use server";
import { redirect } from "next/navigation";
import { agent, AgentError, type Product } from "@/lib/agent";

export type IntakeMsg = { role: "user" | "assistant"; text: string };
export type IntakeDraft = {
  name: string; idea: string; scope: string; customer_segments: string[]; problem: string[]; solution: string[]; uvp: string;
};
export type IntakeTurn = IntakeDraft & { reply: string; ready: boolean; error?: boolean };

export async function intakeTurn(messages: IntakeMsg[]): Promise<IntakeTurn | { reply: string; error: true }> {
  try {
    return await agent<IntakeTurn>("/products/intake", { method: "POST", body: { messages } });
  } catch (e) {
    if (e instanceof AgentError) return { reply: e.message, error: true };
    throw e;
  }
}

export async function createFromIntake(d: IntakeDraft): Promise<{ error?: string }> {
  let id: string;
  try {
    const p = await agent<Product>("/products", { method: "POST", body: {
      name: d.name.trim(), idea: d.idea.trim(), scope: d.scope === "poc" ? "poc" : "mvp",
      canvas: { customer_segments: d.customer_segments, problem: d.problem, solution: d.solution, uvp: d.uvp },
    } });
    id = p.id;
  } catch (e) {
    if (e instanceof AgentError) return { error: e.message };
    throw e;
  }
  redirect(`/p/${id}`);
}
