import { agentRaw } from "@/lib/agent";

// ファクトDB を、画面の絞り込みのまま CSV で保存する
export async function GET(req: Request, { params }: { params: Promise<{ n: string }> }) {
  const { n } = await params;
  const q = new URL(req.url).searchParams;
  const keep = new URLSearchParams();
  for (const k of ["q", "region", "category", "issue", "entity", "frm", "to"]) {
    const v = q.get(k);
    if (v) keep.set(k, v);
  }
  const r = await agentRaw(`/research/${encodeURIComponent(n)}/facts.csv?${keep.toString()}`);
  return new Response(r.body, { status: r.status, headers: {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": r.headers.get("content-disposition") ?? `attachment; filename="RL-${n}-facts.csv"`,
    "cache-control": "private, no-store",
  } });
}
