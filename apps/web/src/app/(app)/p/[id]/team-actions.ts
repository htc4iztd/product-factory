"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { agent, AgentError, type Decision, type DocDetail, type Meeting, type Post, type Ticket } from "@/lib/agent";

type Result = { error?: string };
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const opt = (f: FormData, k: string) => str(f, k) || null;

async function run<T>(fn: () => Promise<T>): Promise<{ ok: T } | { error: string }> {
  try {
    return { ok: await fn() };
  } catch (e) {
    if (e instanceof AgentError) return { error: e.message };
    throw e;
  }
}

// ---------------- チケット ----------------
export async function createDoc(pid: string, _: Result | undefined, f: FormData): Promise<Result> {
  const r = await run(() => agent<DocDetail>(`/products/${pid}/docs`, { method: "POST", body: { title: str(f, "title"), body: "" } }));
  if ("error" in r) return r;
  redirect(`/p/${pid}/docs/${r.ok.number}`);
}

export async function saveDoc(pid: string, n: number, title: string, body: string): Promise<Result> {
  const r = await run(() => agent(`/products/${pid}/docs/${n}`, { method: "PUT", body: { title, body } }));
  if ("error" in r) return r;
  revalidatePath(`/p/${pid}/docs`, "layout");
  return {};
}

export async function readNotices(): Promise<void> {
  await agent("/notices/read", { method: "POST" });
  revalidatePath("/notices");
}

// ---------------- GitHub Issues との同期 ----------------
