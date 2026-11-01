import { agent, AgentError } from "@/lib/agent";

// チャットの対話（数秒ごとに読む）。プロダクトのページではそのプロダクトの対話だけ
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const product = q.get("product") ?? "";
  try {
    return Response.json(await agent(`/assistant/messages?product=${encodeURIComponent(product)}`), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof AgentError) return Response.json({ detail: e.message }, { status: e.status });
    throw e;
  }
}
