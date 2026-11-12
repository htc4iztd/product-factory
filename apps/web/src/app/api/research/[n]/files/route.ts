import { agent, AgentError } from "@/lib/agent";

export const maxDuration = 300;

// リサーチライブラリに資料（PDF・Office・テキスト）を上げる。中身を base64 にして agent-api に渡す（文字の取り出しと要約はそちら）
export async function POST(req: Request, { params }: { params: Promise<{ n: string }> }) {
  const { n } = await params;
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ detail: "ファイルを選んでください" }, { status: 422 });
  if (file.size > 20 * 1024 * 1024) return Response.json({ detail: "ファイルが大きすぎます（20MB まで）" }, { status: 413 });
  try {
    const a = await agent<{ key: string }>(`/research/${encodeURIComponent(n)}/files`, {
      method: "POST",
      body: { filename: file.name, content_b64: Buffer.from(await file.arrayBuffer()).toString("base64"), title: String(form.get("title") ?? "") },
    });
    return Response.json(a);
  } catch (e) {
    if (e instanceof AgentError) return Response.json({ detail: e.message }, { status: e.status });
    throw e;
  }
}
