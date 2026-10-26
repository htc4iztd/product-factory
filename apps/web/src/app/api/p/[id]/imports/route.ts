import { agent, AgentError } from "@/lib/agent";

// 資料のアップロード。ファイルを受け取り、中身を base64 にして agent-api に渡す（読み取りと割り当てはそちらで行う）
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ detail: "ファイルを選んでください" }, { status: 422 });
  if (file.size > 20 * 1024 * 1024) return Response.json({ detail: "ファイルが大きすぎます（20MB まで）" }, { status: 413 });
  const stages = String(form.get("stages") ?? "").split(",").filter(Boolean);
  try {
    const doc = await agent<{ id: number }>(`/products/${encodeURIComponent(id)}/imports`, {
      method: "POST",
      body: {
        filename: file.name, content_b64: Buffer.from(await file.arrayBuffer()).toString("base64"),
        mode: String(form.get("mode") ?? "propose"), stages,
      },
    });
    return Response.json(doc);
  } catch (e) {
    if (e instanceof AgentError) return Response.json({ detail: e.message }, { status: e.status });
    throw e;
  }
}
