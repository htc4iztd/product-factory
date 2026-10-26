"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { agent, AgentError, type JobRun } from "@/lib/agent";

type R = { error?: string };
async function run<T>(fn: () => Promise<T>): Promise<{ ok: T } | { error: string }> {
  try {
    return { ok: await fn() };
  } catch (e) {
    if (e instanceof AgentError) return { error: e.message };
    throw e;
  }
}

export async function startAutodev(pid: string, sid: string, count: number, hint: string): Promise<R> {
  const r = await run(() => agent<JobRun>(`/products/${pid}/stages/${sid}/autodev`, { method: "POST", body: { count, hint } }));
  if ("error" in r) return r;
  redirect(`/p/${pid}/preproducts`);
}

export async function adoptPreProduct(pid: string, n: number): Promise<R> {
  const r = await run(() => agent(`/products/${pid}/preproducts/${n}/adopt`, { method: "POST" }));
  if ("error" in r) return r;
  revalidatePath(`/p/${pid}`, "layout");
  return {};
}

export async function retryAutodev(pid: string, jobId: string): Promise<R> {
  const r = await run(() => agent(`/products/${pid}/autodev/${jobId}/retry`, { method: "POST" }));
  if ("error" in r) return r;
  revalidatePath(`/p/${pid}/preproducts`);
  revalidatePath("/jobs");
  return {};
}

export async function cancelJob(jobId: string): Promise<R> {
  const r = await run(() => agent(`/jobs/${jobId}/cancel`, { method: "POST" }));
  if ("error" in r) return r;
  revalidatePath("/jobs", "layout");
  return {};
}
