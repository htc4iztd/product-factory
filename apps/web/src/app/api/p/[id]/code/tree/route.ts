import { agentRaw, AgentError } from "@/lib/agent";

// IDE（Code-OSS）がファイルの一覧を取る。権限の確認は agent-api が行う
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  // IDE は「プロダクトID」か「プロダクトID~github」で開く（~github はつないだ GitHub、なければ開発の作業場）。?source= でも選べる
  const { id: raw } = await params;
  const [id, tag] = decodeURIComponent(raw).split("~");
  const source = tag === "github" || new URL(_req.url).searchParams.get("source") === "github" ? "github" : "workspace";
  try {
    const res = await agentRaw(`/products/${encodeURIComponent(id)}/code/tree?source=${source}`);
    return new Response(res.body, { status: res.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof AgentError) return Response.json({ detail: e.message }, { status: e.status });
    throw e;
  }
}
