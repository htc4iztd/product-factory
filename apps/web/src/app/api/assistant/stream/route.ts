import { agentPost, AgentError } from "@/lib/agent";

// チャットを流して出す：agent-api の NDJSON（1行ずつの JSON）をそのまま中継する
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return Response.json({ detail: "送る内容がありません" }, { status: 422 });
  try {
    const res = await agentPost("/assistant/messages/stream", body);
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({ detail: "送れませんでした" }));
      return Response.json(err, { status: res.status });
    }
    return new Response(res.body, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" } });
  } catch (e) {
    if (e instanceof AgentError) return Response.json({ detail: e.message }, { status: e.status });
    throw e;
  }
}
