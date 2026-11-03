import { agent, AgentError } from "@/lib/agent";

// 工程の担当との相談（合意メモ・発言）を読む（相談の画面が数秒ごとに読む）
export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: Promise<{ id: string; stage: string }> }) {
  const { id, stage } = await params;
  try {
    return Response.json(await agent(`/products/${encodeURIComponent(id)}/stages/${encodeURIComponent(stage)}/consult`), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof AgentError) return Response.json({ detail: e.message }, { status: e.status });
    throw e;
  }
}
