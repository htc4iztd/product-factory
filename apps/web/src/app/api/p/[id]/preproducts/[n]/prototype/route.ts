import { agentRaw } from "@/lib/agent";

// 生成した試作の HTML。iframe（sandbox）で、このアプリとは別の扱い（クッキーなし・通信なし）で動かす
export async function GET(_: Request, { params }: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await params;
  const r = await agentRaw(`/products/${encodeURIComponent(id)}/preproducts/${encodeURIComponent(n)}/prototype`);
  const headers = new Headers({ "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
  const csp = r.headers.get("content-security-policy");
  if (csp) headers.set("content-security-policy", csp);
  return new Response(r.body, { status: r.status, headers });
}
