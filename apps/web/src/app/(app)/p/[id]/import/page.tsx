import Link from "next/link";
import { ArrowRight, CheckCircle2, CircleSlash, Sparkles } from "lucide-react";
import { agent, type ImportDoc, type Overview } from "@/lib/agent";
import { PageHeader } from "@/components/PageHeader";
import { AutoRefresh } from "@/components/autodev/AutoRefresh";
import { ImportForm } from "@/components/import/ImportForm";

const STATUS: Record<ImportDoc["status"], { label: string; cls: string }> = {
  queued: { label: "待機中", cls: "bg-zinc-100 text-zinc-600" }, running: { label: "割り当て中", cls: "bg-sky-100 text-sky-800" },
  done: { label: "完了", cls: "bg-emerald-100 text-emerald-800" }, failed: { label: "失敗", cls: "bg-rose-100 text-rose-800" },
};
const ACTION = {
  filled: { label: "入れた", icon: CheckCircle2, cls: "text-emerald-600" },
  proposed: { label: "案を出した", icon: Sparkles, cls: "text-brand-600" },
  dropped: { label: "外した", icon: CircleSlash, cls: "text-zinc-400" },
};

export default async function ImportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ doc?: string }> }) {
  const { id } = await params;
  const { doc } = await searchParams;
  const [ov, docs] = await Promise.all([agent<Overview>(`/products/${id}`), agent<ImportDoc[]>(`/products/${id}/imports`)]);
  const selId = Number(doc) || docs[0]?.id;
  const sel = selId ? await agent<ImportDoc>(`/products/${id}/imports/${selId}`).catch(() => null) : null;
  const stageOf = Object.fromEntries(ov.stages.map((s) => [s.id, s]));
  const byStage = new Map<string, ImportDoc["result"]>();
  for (const r of sel?.result ?? []) byStage.set(r.stage, [...(byStage.get(r.stage) ?? []), r]);
  const active = docs.some((d) => d.status === "queued" || d.status === "running");

  return (
    <>
      <AutoRefresh active={active} />
      <PageHeader
        crumbs={<><Link href={`/p/${id}`} className="hover:text-zinc-700">ダッシュボード</Link><span>/</span><span>資料の取り込み</span></>}
        title="資料の取り込み"
        sub="手元の Excel・Word・PowerPoint の資料を読み、どの工程のどの項目にあたるかを AI が見分けて入れます。資料に書かれていないことは入れません。"
      />
      <div className="grid gap-6 px-8 py-6 xl:grid-cols-[400px_minmax(0,1fr)]">
        <div className="space-y-4">
          <ImportForm pid={id} stages={ov.stages} />
          <div className="card divide-y divide-zinc-100">
            <div className="px-4 py-2.5 text-[12px] font-semibold text-zinc-500">取り込んだ資料</div>
            {docs.length === 0 && <p className="px-4 py-4 text-[13px] text-zinc-400">まだありません</p>}
            {docs.map((d) => (
              <Link key={d.id} href={`/p/${id}/import?doc=${d.id}`} className={`flex items-center gap-2 px-4 py-2.5 text-[13px] hover:bg-zinc-50 ${d.id === sel?.id ? "bg-brand-50/50" : ""}`}>
                <span className="min-w-0 flex-1 truncate font-medium">{d.filename}</span>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS[d.status].cls}`}>{STATUS[d.status].label}</span>
              </Link>
            ))}
          </div>
        </div>
        {sel ? (
          <div className="min-w-0 space-y-4">
            <div className="card p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[15px] font-semibold">{sel.filename}</h2>
                <span className="chip">{sel.kind_label}</span>
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS[sel.status].cls}`}>{STATUS[sel.status].label}</span>
                <span className="text-[12px] text-zinc-500">{sel.mode === "fill" ? "空の項目には直接入れる" : "AI の案として出す"}・{sel.chars.toLocaleString()}文字・{sel.created_by}</span>
                {sel.job_id && <Link href={`/jobs/${sel.job_id}`} className="ml-auto text-[12px] text-brand-700 hover:underline">ジョブの工程を見る</Link>}
              </div>
              {sel.outline.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">{sel.outline.slice(0, 40).map((h, i) => <span key={i} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600">{h}</span>)}</div>
              )}
            </div>
            {sel.status === "done" && byStage.size === 0 && (
              <div className="card p-5 text-[13px] text-zinc-500">この資料には、工程の項目にあたる具体的な中身が見つかりませんでした。</div>
            )}
            {[...byStage.entries()].map(([sid, rows]) => {
              const s = stageOf[sid];
              return (
                <div key={sid} className="card p-5">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-[14px] font-semibold">{s?.no} {s?.name}</span>
                    <Link href={`/p/${id}/s/${sid}`} className="ml-auto flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:underline">
                      {rows.some((r) => r.action === "proposed") ? "工程を開いて案を選ぶ" : "工程を開く"}<ArrowRight size={12} />
                    </Link>
                  </div>
                  <ul className="divide-y divide-zinc-100">
                    {rows.map((r, i) => {
                      const a = ACTION[r.action];
                      return (
                        <li key={i} className="flex items-start gap-2 py-2 text-[13px]">
                          <a.icon size={14} className={`mt-0.5 shrink-0 ${a.cls}`} />
                          <span className="w-40 shrink-0 font-medium">{r.label}</span>
                          <span className={`w-20 shrink-0 text-[12px] ${a.cls}`}>{a.label}</span>
                          <span className="min-w-0 text-[12px] text-zinc-500">{r.reason}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
            {sel.preview && (
              <details className="card p-5">
                <summary className="cursor-pointer select-none text-[13px] font-medium">読み取った文章（冒頭）</summary>
                <pre className="mt-3 max-h-[480px] overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-[11px] leading-5 text-zinc-700">{sel.preview}</pre>
              </details>
            )}
          </div>
        ) : (
          <div className="card flex items-center justify-center p-10 text-[13px] text-zinc-400">資料を取り込むと、ここに工程ごとの割り当てが出ます</div>
        )}
      </div>
    </>
  );
}
