import { agent, AgentError } from "@/lib/agent";

// 開発の作業場（ユニット・変更の記録・GitHub への写し）を読む。開発の画面が数秒ごとに読む
export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return Response.json(await agent(`/products/${encodeURIComponent(id)}/workspace`), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof AgentError) return Response.json({ detail: e.message }, { status: e.status });
    throw e;
  }
}
