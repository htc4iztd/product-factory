import Link from "next/link";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { agent, type AutodevRun, type Overview, type PreProductDetail } from "@/lib/agent";
import { PageHeader } from "@/components/PageHeader";
import { AutoRefresh } from "@/components/autodev/AutoRefresh";
import { JobProgress, JobStatus, tokens, duration } from "@/components/autodev/JobBits";
import { AdoptButton, RetryButton } from "@/components/autodev/PreProductActions";
import { when } from "@/components/team/RefText";

const PP_STATUS: Record<string, string> = { generating: "作成中", ready: "できあがり", failed: "失敗", adopted: "採用済み" };

export default async function PreProductsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ compare?: string; stage?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const [{ runs }, ov] = await Promise.all([agent<{ runs: AutodevRun[] }>(`/products/${id}/preproducts`), agent<Overview>(`/products/${id}`)]);
  const name = Object.fromEntries(ov.stages.map((s) => [s.id, `${s.no}${s.name}`]));
  const active = runs.some((r) => r.status === "queued" || r.status === "running");
  const cmp = runs.find((r) => r.id === sp.compare);
  const details = cmp ? await Promise.all(cmp.pre_products.map((p) => agent<PreProductDetail>(`/products/${id}/preproducts/${p.number}`))) : [];
  const stages = cmp ? (cmp.params.stages as string[]) : [];
  const stage = sp.stage && stages.includes(sp.stage) ? sp.stage : stages[0];
  return (
    <>
      <AutoRefresh active={active} />
      <PageHeader crumbs={<span>プロダクト</span>} title="プリプロダクト"
        sub="上流で決めたことに従って、AI がパターンごとに後工程と動く試作を作ったプロダクト案です。比べて1つを採用すると、その内容が各ステージの下書きに入ります。各ステージの「以降の工程を自動開発する」から作ります。" />
      <div className="space-y-6 px-8 py-6">
        {runs.length === 0 && <p className="card p-6 text-[13px] text-zinc-500">まだありません。ステージ（例：⑥プロダクト仕様）の右上の「以降の工程を自動開発する」から始めます。</p>}
        {runs.map((r) => (
          <section key={r.id} className="card space-y-4 p-5" aria-label={`自動開発 ${r.id}`}>
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <JobStatus status={r.status} />
              <span className="font-medium">{name[String(r.params.from_stage)]} から自動開発（{(r.params.stages as string[]).map((x) => name[x]).join("・")} × {String(r.params.count)}案）</span>
              {String(r.params.hint || "") && <span className="chip">軸：{String(r.params.hint)}</span>}
              <span className="text-xs text-zinc-400">{r.created_by}・{when(r.created_at)}・{duration(r.seconds)}・{tokens(r)}</span>
              <Link href={`/jobs/${r.id}`} className="ml-auto text-xs text-brand-700 hover:underline">ジョブの詳細</Link>
            </div>
            {(r.status === "queued" || r.status === "running") && <JobProgress job={r} />}
            {r.error && <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{r.error}</p>}
            {r.upstream_changed.length > 0 && (
              <p className="flex items-center gap-1.5 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <AlertTriangle size={13} />作ったあとで上流（{r.upstream_changed.map((x) => name[x]).join("・")}）の版が変わっています。採用する前に見直すか、作り直してください。
                <RetryButton pid={id} jobId={r.id} />
              </p>
            )}
            {r.status === "failed" && r.upstream_changed.length === 0 && <RetryButton pid={id} jobId={r.id} />}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {r.pre_products.slice().reverse().map((p) => (
                <article key={p.key} className={`overflow-hidden rounded-xl border ${p.status === "adopted" ? "border-emerald-300 ring-2 ring-emerald-100" : "border-zinc-200"} bg-white`}>
                  <div className="h-48 overflow-hidden border-b border-zinc-100 bg-zinc-50">
                    {p.has_prototype ? (
                      <iframe title={`${p.key} の試作`} src={`/api/p/${id}/preproducts/${p.number}/prototype`} sandbox="allow-scripts allow-forms allow-modals"
                        className="pointer-events-none h-[384px] w-[200%] origin-top-left scale-50 border-0" />
                    ) : <div className="flex h-full items-center justify-center text-xs text-zinc-400">{p.status === "failed" ? "作れませんでした" : "試作を作っています…"}</div>}
                  </div>
                  <div className="space-y-2 p-4">
                    <div className="flex items-center gap-2 text-[11px] text-zinc-400"><span className="font-mono">{p.key}</span><span className="chip">{PP_STATUS[p.status]}</span></div>
                    <h3 className="text-[14px] font-semibold">{p.title}</h3>
                    <p className="line-clamp-3 text-[12px] leading-5 text-zinc-600">{p.concept}</p>
                    {p.error && <p className="text-xs text-rose-600">{p.error}</p>}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Link href={`/p/${id}/preproducts/${p.number}`} className="btn-secondary btn-sm">詳しく見る</Link>
                      {p.has_prototype && <a href={`/api/p/${id}/preproducts/${p.number}/prototype`} target="_blank" rel="noreferrer" className="btn-ghost btn-sm"><ExternalLink size={12} />試作を開く</a>}
                      {(p.status === "ready" || p.status === "adopted") && <AdoptButton pid={id} n={p.number} adopted={p.status === "adopted"} />}
                    </div>
                  </div>
                </article>
              ))}
            </div>
            {r.status === "done" && r.pre_products.length > 1 && (
              cmp?.id === r.id ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-xs text-zinc-500">工程ごとに比べる</span>
                    {stages.map((s) => <Link key={s} href={`/p/${id}/preproducts?compare=${r.id}&stage=${s}`} className={`chip ${s === stage ? "border-zinc-900 bg-zinc-900 text-white" : ""}`}>{name[s]}</Link>)}
                    <Link href={`/p/${id}/preproducts`} className="ml-auto text-xs text-zinc-500 hover:underline">閉じる</Link>
                  </div>
                  <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${details.length}, minmax(0, 1fr))` }}>
                    {details.slice().reverse().map((d) => (
                      <div key={d.key} className="min-w-0 rounded-lg border border-zinc-200 p-3">
                        <div className="mb-2 text-xs font-semibold">{d.key} {d.title}</div>
                        <div className="prose-md max-h-[60vh] overflow-y-auto text-[12px]"><Markdown remarkPlugins={[remarkGfm]}>{d.markdown[stage] ?? "（なし）"}</Markdown></div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : <Link href={`/p/${id}/preproducts?compare=${r.id}`} className="btn-secondary btn-sm w-fit">案を並べて比べる</Link>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
