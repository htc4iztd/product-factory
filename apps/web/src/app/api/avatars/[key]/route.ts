import { agentRaw, AgentError } from "@/lib/agent";

// エージェントの顔。版（v）が変わるまでブラウザに置いておく
export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  try {
    const res = await agentRaw(`/avatars/${encodeURIComponent(key)}`);
    if (!res.ok) return new Response("not found", { status: res.status });
    return new Response(res.body, {
      headers: {
        "content-type": res.headers.get("content-type") ?? "image/png",
        "cache-control": "private, max-age=604800",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
      },
    });
  } catch (e) {
    if (e instanceof AgentError) return new Response(e.message, { status: e.status });
    throw e;
  }
}
