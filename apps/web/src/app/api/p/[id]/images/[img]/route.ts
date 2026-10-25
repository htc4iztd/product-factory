import { agentRaw, AgentError } from "@/lib/agent";

// プロダクト・キャンバスの画像。権限の確認は agent-api が行う（同じテナントの人だけが見られる）
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; img: string }> }) {
  const { id, img } = await params;
  try {
    const res = await agentRaw(`/products/${encodeURIComponent(id)}/images/${encodeURIComponent(img)}`);
    if (!res.ok) return new Response("not found", { status: res.status });
    return new Response(res.body, {
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/octet-stream",
        "cache-control": "private, max-age=86400",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
      },
    });
  } catch (e) {
    if (e instanceof AgentError) return new Response(e.message, { status: e.status });
    throw e;
  }
}
