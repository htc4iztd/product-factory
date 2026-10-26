import Link from "next/link";
import { agent, type Overview, type ProductReport } from "@/lib/agent";
import { PageHeader } from "@/components/PageHeader";
import { AutoRefresh } from "@/components/autodev/AutoRefresh";
import { ReportEditor } from "@/components/report/ReportEditor";

export default async function ReportPage({ params }: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await params;
  const [ov, r] = await Promise.all([agent<Overview>(`/products/${id}`), agent<ProductReport>(`/products/${id}/reports/${n}`)]);
  const stageNames = Object.fromEntries(ov.stages.map((s) => [s.id, `${s.no}${s.name}`]));
  const busy = r.status === "queued" || r.status === "running";
  return (
    <>
      <AutoRefresh active={busy} />
      <PageHeader
        crumbs={<><Link href={`/p/${id}`} className="hover:text-zinc-700">概要</Link><span>/</span><Link href={`/p/${id}/reports`} className="hover:text-zinc-700">報告資料</Link><span>/</span><span>{r.key}</span></>}
        title={r.title}
        sub={[r.audience && `読み手：${r.audience}`, r.purpose && `目的：${r.purpose}`].filter(Boolean).join("　") || "読み手・目的の指定なし"}
        actions={r.job_id ? <Link href={`/jobs/${r.job_id}`} className="btn-secondary">ジョブの工程を見る</Link> : undefined}
      >
        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
          {r.selection.map((x) => (
            <span key={x.stage} className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-600">
              {stageNames[x.stage]}（{x.fields.length}項目{r.data?.basis?.[x.stage] ? `・${r.data.basis[x.stage]}` : ""}）
            </span>
          ))}
        </div>
      </PageHeader>
      <div className="px-8 py-6">
        {busy && <div className="card p-6 text-[13px] text-zinc-600">AI が構成と本文を作っています…（ジョブの画面で工程を見られます）</div>}
        {r.status === "failed" && <div className="card border-rose-200 bg-rose-50 p-4 text-[13px] text-rose-700">作れませんでした：{r.error}</div>}
        {r.status === "done" && r.data && <ReportEditor pid={id} r={r} product={ov.product.name} stageNames={stageNames} />}
      </div>
    </>
  );
}
