import { agent, AgentError } from "@/lib/agent";

// 変更の記録 1つ（差分つき）
export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await params;
  try {
    return Response.json(await agent(`/products/${encodeURIComponent(id)}/workspace/commits/${encodeURIComponent(n)}`));
  } catch (e) {
    if (e instanceof AgentError) return Response.json({ detail: e.message }, { status: e.status });
    throw e;
  }
}
