"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { agent, AgentError, type JobRun, type ResearchArticle, type ResearchLibrary, type ResearchNote } from "@/lib/agent";

type Result = { error?: string };
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const lines = (f: FormData, k: string) => str(f, k).split(/\n/).map((x) => x.trim()).filter(Boolean);

async function run<T>(fn: () => Promise<T>): Promise<{ ok: T } | { error: string }> {
  try {
    return { ok: await fn() };
  } catch (e) {
    if (e instanceof AgentError) return { error: e.message };
    throw e;
  }
}

function libraryBody(f: FormData) {
  return {
    name: str(f, "name"), description: str(f, "description"), instructions: str(f, "instructions"),
    use_search: f.get("use_search") === "on", feeds: lines(f, "feeds"), sites: lines(f, "sites"),
    issues: lines(f, "issues"), entities: lines(f, "entities"), since: str(f, "since") || null,
  };
}

export async function createLibrary(_: Result | undefined, f: FormData): Promise<Result> {
  const r = await run(() => agent<ResearchLibrary>("/research", { method: "POST", body: libraryBody(f) }));
  if ("error" in r) return r;
  redirect(`/research/${r.ok.number}?tab=settings`);
}

export async function updateLibrary(n: number, _: Result | undefined, f: FormData): Promise<Result> {
  const r = await run(() => agent(`/research/${n}`, { method: "PUT", body: libraryBody(f) }));
  if ("error" in r) return r;
  revalidatePath(`/research/${n}`);
  return {};
}

export async function startUpdate(n: number): Promise<Result> {
  const r = await run(() => agent<JobRun>(`/research/${n}/update`, { method: "POST" }));
  if ("error" in r) return r;
  revalidatePath(`/research/${n}`);
  return {};
}

export async function addArticle(n: number, _: Result | undefined, f: FormData): Promise<Result> {
  const r = await run(() => agent<ResearchArticle>(`/research/${n}/articles`, { method: "POST", body: { url: str(f, "url"), title: str(f, "title"), text: str(f, "text") } }));
  if ("error" in r) return r;
  revalidatePath(`/research/${n}`);
  return {};
}

export async function saveMemo(n: number, article: number, memo: string): Promise<Result> {
  const r = await run(() => agent(`/research/articles/${article}/memo`, { method: "PUT", body: { memo } }));
  if ("error" in r) return r;
  revalidatePath(`/research/${n}`);
  return {};
}

export async function analyze(n: number, question: string, filters: Record<string, string>): Promise<Result & { note?: ResearchNote }> {
  const r = await run(() => agent<ResearchNote>(`/research/${n}/analyze`, { method: "POST", body: { question, filters } }));
  if ("error" in r) return r;
  revalidatePath(`/research/${n}`);
  return { note: r.ok };
}

export async function refreshIssues(n: number): Promise<Result> {
  const r = await run(() => agent(`/research/${n}/issues/refresh`, { method: "POST" }));
  if ("error" in r) return r;
  revalidatePath(`/research/${n}`);
  return {};
}

// 発言の上限に収まるよう、行の切れ目で切る
function fit(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return cut.slice(0, cut.lastIndexOf("\n")) + "\n…（以下省略）";
}

// ステージの対話から：ライブラリの一覧と、要約を AI への発言として送る
export async function researchChoices(): Promise<{ number: number; key: string; name: string; issues: string[]; facts: number }[]> {
  const libs = await agent<ResearchLibrary[]>("/research");
  return libs.map((l) => ({ number: l.number, key: l.key, name: l.name, issues: l.issues, facts: l.facts ?? 0 }));
}

export async function sendResearchToStage(pid: string, sid: string, n: number, issue: string, sessionId: string | null): Promise<Result> {
  const r = await run(async () => {
    const { brief } = await agent<{ brief: string }>(`/research/${n}/brief${issue ? `?issue=${encodeURIComponent(issue)}` : ""}`);
    const message = "次のリサーチ結果を根拠にして、この工程の項目の案を出してください。数字や主張には根拠のファクト番号 [RF-n] か記事番号 [RA-n] を添え、"
      + "【原文未確認】のファクトは確かめが要ると書いてください。\n\n" + fit(brief, 18000);
    return agent(`/products/${pid}/stages/${sid}/chat`, { method: "POST", body: { message, session_id: sessionId } });
  });
  if ("error" in r) return r;
  revalidatePath(`/p/${pid}`, "layout");
  return {};
}
