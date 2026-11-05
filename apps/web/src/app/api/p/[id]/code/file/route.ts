import { agentRaw, AgentError } from "@/lib/agent";

// IDE（Code-OSS）がファイルの中身を取る。中身はそのまま返し、ブラウザには実行させない
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const [id, tag] = decodeURIComponent(raw).split("~");
  const source = tag === "github" || new URL(req.url).searchParams.get("source") === "github" ? "github" : "workspace";
  const path = new URL(req.url).searchParams.get("path") ?? "";
  try {
    const res = await agentRaw(`/products/${encodeURIComponent(id)}/code/file?path=${encodeURIComponent(path)}&source=${source}`);
    return new Response(res.body, {
      status: res.status,
      headers: {
        "content-type": res.ok ? "application/octet-stream" : "application/json",
        "cache-control": "private, max-age=30",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  } catch (e) {
    if (e instanceof AgentError) return Response.json({ detail: e.message }, { status: e.status });
    throw e;
  }
}
