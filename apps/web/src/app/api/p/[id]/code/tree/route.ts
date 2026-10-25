import { agentRaw, AgentError } from "@/lib/agent";

// IDE（Code-OSS）がファイルの一覧を取る。権限の確認は agent-api が行う
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const res = await agentRaw(`/products/${encodeURIComponent(id)}/code/tree`);
    return new Response(res.body, { status: res.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof AgentError) return Response.json({ detail: e.message }, { status: e.status });
    throw e;
  }
}
