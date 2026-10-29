import { agent, AgentError } from "@/lib/agent";

// 対話に添える資料・画像を受け取り、中身を base64 にして agent-api に渡す（文章にするのはそちら）
export async function POST(req: Request, { params }: { params: Promise<{ id: string; agent: string }> }) {
  const { id, agent: who } = await params;
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ detail: "ファイルを選んでください" }, { status: 422 });
  if (file.size > 20 * 1024 * 1024) return Response.json({ detail: "ファイルが大きすぎます（20MB まで）" }, { status: 413 });
  try {
    const r = await agent(`/products/${encodeURIComponent(id)}/agents/${encodeURIComponent(who)}/attachments`, {
      method: "POST", body: { filename: file.name || "貼り付けた画像.png", content_b64: Buffer.from(await file.arrayBuffer()).toString("base64") },
    });
    return Response.json(r);
  } catch (e) {
    if (e instanceof AgentError) return Response.json({ detail: e.message }, { status: e.status });
    throw e;
  }
}
