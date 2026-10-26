import Link from "next/link";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink } from "lucide-react";
import { agent, type Overview, type PreProductDetail } from "@/lib/agent";
import { PageHeader } from "@/components/PageHeader";
import { AdoptButton } from "@/components/autodev/PreProductActions";

export default async function PreProductPage({ params, searchParams }: { params: Promise<{ id: string; n: string }>; searchParams: Promise<{ stage?: string }> }) {
  const { id, n } = await params;
  const sp = await searchParams;
  const [p, ov] = await Promise.all([agent<PreProductDetail>(`/products/${id}/preproducts/${n}`), agent<Overview>(`/products/${id}`)]);
  const name = Object.fromEntries(ov.stages.map((s) => [s.id, `${s.no} ${s.name}`]));
  const stage = sp.stage && p.markdown[sp.stage] ? sp.stage : p.stages[0];
  return (
    <>
      <PageHeader crumbs={<><Link href={`/p/${id}/preproducts`} className="hover:text-zinc-700">プリプロダクト</Link><span>/</span><span>{p.key}</span></>}
        title={<><span className="font-mono text-base text-zinc-400">{p.key}</span>{p.title}</>}
        sub={p.concept}
        actions={(p.status === "ready" || p.status === "adopted") && <div className="flex flex-wrap items-center gap-2"><AdoptButton pid={id} n={p.number} adopted={p.status === "adopted"} /></div>} />
      <div className="grid gap-6 px-8 py-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section className="card overflow-hidden" aria-label="試作">
          <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2 text-xs text-zinc-500">
            <span>試作（ブラウザで触れます。外部への通信はできません）</span>
            {p.has_prototype && <a href={`/api/p/${id}/preproducts/${p.number}/prototype`} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-zinc-800"><ExternalLink size={12} />別のタブで開く</a>}
          </div>
          {p.has_prototype ? <iframe title={`${p.key} の試作`} src={`/api/p/${id}/preproducts/${p.number}/prototype`} sandbox="allow-scripts allow-forms allow-modals" className="h-[70vh] w-full border-0" />
            : <p className="p-6 text-[13px] text-zinc-400">試作はまだありません。</p>}
        </section>
        <section className="space-y-3">
          {p.assumptions.length > 0 && (
            <div className="card p-4 text-[13px]"><div className="section-title mb-1">この案の前提</div><ul className="list-disc pl-5">{p.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {p.stages.map((s) => <Link key={s} href={`/p/${id}/preproducts/${p.number}?stage=${s}`} className={`chip ${s === stage ? "border-zinc-900 bg-zinc-900 text-white" : "hover:border-zinc-300"}`}>{name[s] ?? s}</Link>)}
          </div>
          <div className="card prose-md max-h-[64vh] overflow-y-auto p-5 text-[13px]"><Markdown remarkPlugins={[remarkGfm]}>{p.markdown[stage] ?? "（なし）"}</Markdown></div>
        </section>
      </div>
    </>
  );
}
