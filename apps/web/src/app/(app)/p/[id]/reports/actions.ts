"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { agent, AgentError, type ProductReport, type ReportSlide } from "@/lib/agent";

type R = { error?: string };
async function run<T>(fn: () => Promise<T>): Promise<{ ok: T } | { error: string }> {
  try {
    return { ok: await fn() };
  } catch (e) {
    if (e instanceof AgentError) return { error: e.message };
    throw e;
  }
}

export async function createReport(pid: string, body: {
  title: string; audience: string; purpose: string; selection: { stage: string; fields: string[] }[]; source: string; slides: number;
}): Promise<R> {
  const r = await run(() => agent<ProductReport>(`/products/${pid}/reports`, { method: "POST", body }));
  if ("error" in r) return r;
  redirect(`/p/${pid}/reports/${r.ok.number}`);
}

export async function saveReport(pid: string, n: number, title: string, slides: ReportSlide[], summary: string): Promise<R> {
  const r = await run(() => agent(`/products/${pid}/reports/${n}`, { method: "PUT", body: { title, data: { slides, summary } } }));
  if ("error" in r) return r;
  revalidatePath(`/p/${pid}/reports/${n}`);
  return {};
}

export async function regenerateReport(pid: string, n: number): Promise<R> {
  const r = await run(() => agent(`/products/${pid}/reports/${n}/regenerate`, { method: "POST" }));
  if ("error" in r) return r;
  revalidatePath(`/p/${pid}/reports/${n}`);
  return {};
}

export async function deleteReport(pid: string, n: number): Promise<R> {
  const r = await run(() => agent(`/products/${pid}/reports/${n}`, { method: "DELETE" }));
  if ("error" in r) return r;
  redirect(`/p/${pid}/reports`);
}
