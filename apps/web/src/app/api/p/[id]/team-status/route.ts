import { agent, AgentError } from "@/lib/agent";

// レールが数秒ごとに読む：エージェントの状態（作業中・詰まり・待ち）と、定期実行・プラットフォームの印
export const dynamic = "force-dynamic";
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const t = await agent(`/products/${encodeURIComponent(id)}/team`);
    return Response.json(t, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof AgentError) return Response.json({ detail: e.message }, { status: e.status });
    throw e;
  }
}
