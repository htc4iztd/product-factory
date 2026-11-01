import { agent, AgentError } from "@/lib/agent";

// チャットの発言（数秒ごとに読む）
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const after = new URL(req.url).searchParams.get("after") ?? "0";
  try {
    return Response.json(await agent(`/assistant/messages?after=${encodeURIComponent(after)}`), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof AgentError) return Response.json({ detail: e.message }, { status: e.status });
    throw e;
  }
}
