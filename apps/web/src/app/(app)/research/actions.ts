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

// 論点は1行に1つ。「論点名｜その論点で問うこと」と書けば問いも持てる
function libraryBody(f: FormData) {
  const defs: Record<string, string> = {};
  const issues = lines(f, "issues").map((l) => {
    const [name, q] = l.split(/[｜|]/).map((x) => x.trim());
    if (q) defs[name] = q;
    return name;
  }).filter(Boolean);
  return {
    name: str(f, "name"), description: str(f, "description"), instructions: str(f, "instructions"),
    use_search: f.get("use_search") === "on", feeds: lines(f, "feeds"), sites: lines(f, "sites"),
    issues, issue_defs: defs, entities: lines(f, "entities"), since: str(f, "since") || null,
    ...(f.has("layers") ? { layers: lines(f, "layers") } : {}), ...(f.has("topics") ? { topics: lines(f, "topics") } : {}),
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

// scope：all（すべて）| articles | issues | players | tech | industry | public
export async function startUpdate(n: number, scope = "all"): Promise<Result> {
  const r = await run(() => agent<JobRun>(`/research/${n}/update`, { method: "POST", body: { scope } }));
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

// ステージの対話から：ライブラリの一覧と、要約を AI への発言として送る
export async function researchChoices(): Promise<{ number: number; key: string; name: string; issues: string[]; facts: number }[]> {
  const libs = await agent<ResearchLibrary[]>("/research");
  return libs.map((l) => ({ number: l.number, key: l.key, name: l.name, issues: l.issues, facts: l.facts ?? 0 }));
}

// リサーチの要約を、工程の領域の PM に渡す（PM が担当への Issue にする）
// ---------------- 画面の中の操作（記事・ファクト・質問・プレーヤー・調査レポート） ----------------
async function act(n: number, fn: () => Promise<unknown>): Promise<Result> {
  const r = await run(fn);
  if ("error" in r) return r;
  revalidatePath(`/research/${n}`);
  return {};
}

export type FactInput = { kind: string; theme: string; metric: string; value: string; scope: string; source: string; date?: string };
export async function addFact(n: number, article: number, body: FactInput): Promise<Result> {
  return act(n, () => agent(`/research/articles/${article}/facts`, { method: "POST", body }));
}
export async function deleteFact(n: number, fact: number): Promise<Result> {
  return act(n, () => agent(`/research/facts/${fact}`, { method: "DELETE" }));
}
export async function askQuestion(n: number, article: number, question: string): Promise<Result> {
  return act(n, () => agent(`/research/articles/${article}/questions`, { method: "POST", body: { question } }));
}
export async function retryQuestion(n: number, id: number): Promise<Result> {
  return act(n, () => agent(`/research/questions/${id}/retry`, { method: "POST" }));
}
export async function deleteQuestion(n: number, id: number): Promise<Result> {
  return act(n, () => agent(`/research/questions/${id}`, { method: "DELETE" }));
}
export type PlayerInput = { name: string; aliases: string[]; layer: string; region: string; role: string; detail: string; stance: string; tags: string[] };
export async function savePlayer(n: number, id: number | null, body: PlayerInput): Promise<Result> {
  return act(n, () => agent(id ? `/research/${n}/players/${id}` : `/research/${n}/players`, { method: id ? "PUT" : "POST", body }));
}
export async function deletePlayer(n: number, id: number): Promise<Result> {
  return act(n, () => agent(`/research/${n}/players/${id}`, { method: "DELETE" }));
}
export async function createReport(n: number, kind: string, title: string, instructions: string): Promise<Result> {
  return act(n, () => agent(`/research/${n}/reports`, { method: "POST", body: { kind, title, instructions } }));
}
export async function retryReport(n: number, id: number): Promise<Result> {
  return act(n, () => agent(`/research/reports/${id}/retry`, { method: "POST" }));
}
export async function deleteReport(n: number, id: number): Promise<Result> {
  return act(n, () => agent(`/research/reports/${id}`, { method: "DELETE" }));
}
