import { agentRaw } from "@/lib/agent";

// 記事の元の資料（上げた PDF・Office）を開く。PDF はブラウザで表示し、それ以外は保存する
export async function GET(_: Request, { params }: { params: Promise<{ a: string }> }) {
  const { a } = await params;
  const r = await agentRaw(`/research/articles/${encodeURIComponent(a)}/file`);
  if (!r.ok) return new Response("元の資料が見つかりません", { status: r.status, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(r.body, { status: 200, headers: {
    "content-type": r.headers.get("content-type") ?? "application/octet-stream",
    "content-disposition": r.headers.get("content-disposition") ?? "attachment",
    "x-content-type-options": "nosniff",
    "cache-control": "private, no-store",
  } });
}
