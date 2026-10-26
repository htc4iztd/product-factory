"use server";
import { revalidatePath } from "next/cache";
import { agent, AgentError, type Concept } from "@/lib/agent";

type Result = { error?: string };

async function run<T>(fn: () => Promise<T>): Promise<{ ok: T } | { error: string }> {
  try {
    return { ok: await fn() };
  } catch (e) {
    if (e instanceof AgentError) return { error: e.message };
    throw e;
  }
}

async function done<T>(fn: () => Promise<T>): Promise<Result> {
  const r = await run(fn);
  if ("error" in r) return r;
  revalidatePath("/ontology");
  return {};
}

export type ConceptInput = { label: string; kind: string; definition: string; aliases: string[]; examples: string[]; status?: string };

export async function saveConcept(id: number | null, body: ConceptInput): Promise<Result> {
  return done(() => agent<Concept>(id ? `/ontology/concepts/${id}` : "/ontology/concepts", { method: id ? "PUT" : "POST", body }));
}

export async function deleteConcept(id: number): Promise<Result> {
  return done(() => agent(`/ontology/concepts/${id}`, { method: "DELETE" }));
}

export async function addRelation(source: number, target: number, type: string, note: string): Promise<Result> {
  return done(() => agent("/ontology/relations", { method: "POST", body: { source, target, type, note } }));
}

export async function deleteRelation(id: number): Promise<Result> {
  return done(() => agent(`/ontology/relations/${id}`, { method: "DELETE" }));
}

export async function suggestConcepts(): Promise<Result & { count?: number }> {
  const r = await run(() => agent<{ concepts: Concept[] }>("/ontology/suggest", { method: "POST" }));
  if ("error" in r) return r;
  revalidatePath("/ontology");
  return { count: r.ok.concepts.length };
}

export async function importOntology(format: string, text: string): Promise<Result & { summary?: string }> {
  const r = await run(() => agent<{ created: number; updated: number; relations: number }>("/ontology/import", { method: "POST", body: { format, text } }));
  if ("error" in r) return r;
  revalidatePath("/ontology");
  return { summary: `追加 ${r.ok.created}件・更新 ${r.ok.updated}件・関係 ${r.ok.relations}件` };
}

export async function checkContext(text: string): Promise<{ context?: string; error?: string }> {
  const r = await run(() => agent<{ context: string }>("/ontology/context", { method: "POST", body: { text } }));
  return "error" in r ? r : { context: r.ok.context };
}
