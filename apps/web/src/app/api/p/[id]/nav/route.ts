import { agent, AgentError, type Overview } from "@/lib/agent";

// スマホの一覧（左から出る）：プロダクトと工程
export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const ov = await agent<Overview>(`/products/${id}`);
    return Response.json({ product: { id: ov.product.id, name: ov.product.name }, stages: ov.stages.map((s) => ({ id: s.id, no: s.no, name: s.name, status: s.status, enabled: s.enabled })) });
  } catch (e) {
    if (e instanceof AgentError) return Response.json({ detail: e.message }, { status: e.status });
    throw e;
  }
}
