import Link from "next/link";
import { agent, type Overview, type ProductReport, type ReportSource } from "@/lib/agent";
import { PageHeader } from "@/components/PageHeader";
import { AutoRefresh } from "@/components/autodev/AutoRefresh";
import { NewReportForm } from "@/components/report/NewReportForm";

const STATUS: Record<ProductReport["status"], { label: string; cls: string }> = {
  queued: { label: "待機中", cls: "bg-zinc-100 text-zinc-600" }, running: { label: "作成中", cls: "bg-sky-100 text-sky-800" },
  done: { label: "完了", cls: "bg-emerald-100 text-emerald-800" }, failed: { label: "失敗", cls: "bg-rose-100 text-rose-800" },
};

export default async function ReportsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [ov, sources, list] = await Promise.all([
    agent<Overview>(`/products/${id}`), agent<ReportSource[]>(`/products/${id}/report-sources`), agent<ProductReport[]>(`/products/${id}/reports`),
  ]);
  const phases = Object.fromEntries(ov.phases.map((p) => [p.id, p.stages]));
  return (
    <>
      <AutoRefresh active={list.some((r) => r.status === "queued" || r.status === "running")} />
      <PageHeader
        crumbs={<><Link href={`/p/${id}`} className="hover:text-zinc-700">概要</Link><span>/</span><span>報告資料</span></>}
        title="報告資料"
        sub="各工程で決めた企画情報から範囲を選ぶと、読み手と目的に合わせて AI がスライドにまとめます。直してから PowerPoint・Markdown にできます。"
      />
      <div className="space-y-6 px-8 py-6">
        {list.length > 0 && (
          <div className="card divide-y divide-zinc-100">
            {list.map((r) => (
              <Link key={r.number} href={`/p/${id}/reports/${r.number}`} className="flex items-center gap-3 px-4 py-2.5 text-[13px] hover:bg-zinc-50">
                <span className="font-mono text-[11px] text-zinc-500">{r.key}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{r.title}</span>
                <span className="text-[12px] text-zinc-500">{r.selection.length}工程・{r.data?.slides.length ?? 0}枚</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
                <span className="w-36 text-right text-[11px] text-zinc-400">{new Date(r.updated_at).toLocaleString("ja-JP")}</span>
              </Link>
            ))}
          </div>
        )}
        <section>
          <h2 className="mb-2 text-[14px] font-semibold">新しい報告資料</h2>
          <NewReportForm pid={id} sources={sources} phases={phases} />
        </section>
      </div>
    </>
  );
}
