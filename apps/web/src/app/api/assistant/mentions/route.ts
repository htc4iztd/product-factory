import { agent, AgentError } from "@/lib/agent";

// @ で選べるもの（工程・ページ・エージェント）
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const product = new URL(req.url).searchParams.get("product") ?? "";
  try {
    return Response.json(await agent(`/assistant/mentions?product=${encodeURIComponent(product)}`));
  } catch (e) {
    if (e instanceof AgentError) return Response.json({ detail: e.message }, { status: e.status });
    throw e;
  }
}
