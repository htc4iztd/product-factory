import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { agent, type JobDef, type JobRun, type Product } from "@/lib/agent";
import { Logo } from "@/components/Logo";
import { UserMenu } from "@/components/UserMenu";
import { AutoRefresh } from "@/components/autodev/AutoRefresh";
import { JobProgress, JobStatus, duration, jobTarget } from "@/components/autodev/JobBits";
import { when } from "@/components/team/RefText";

const f = (n: number) => n.toLocaleString("ja-JP");

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const sp = await searchParams;
  const [{ definitions, runs }, products] = await Promise.all([
    agent<{ definitions: JobDef[]; runs: JobRun[] }>(`/jobs${sp.kind ? `?kind=${encodeURIComponent(sp.kind)}` : ""}`),
    agent<Product[]>("/products"),
  ]);
  const pname = Object.fromEntries(products.map((p) => [p.id, p.name]));
  const active = runs.some((r) => r.status === "queued" || r.status === "running");
  const sum = runs.reduce((a, r) => ({ i: a.i + (r.usage?.input_tokens ?? 0), o: a.o + (r.usage?.output_tokens ?? 0) }), { i: 0, o: 0 });
  return (
    <>
      <AutoRefresh active={active} />
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6"><Logo /><UserMenu /></div>
      </header>
      <main className="mx-auto max-w-6xl space-y-8 px-6 py-10">
        <div>
          <Link href="/" className="mb-3 flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900"><ChevronLeft size={14} />すべてのプロダクト</Link>
          <h1 className="text-2xl font-semibold tracking-tight">ジョブ</h1>
          <p className="mt-1 text-sm text-zinc-500">時間のかかる処理（自動開発など）の定義・走行状況・実行履歴と、使った LLM のトークン量です。</p>
        </div>

        <section aria-label="ジョブの定義" className="grid gap-4 md:grid-cols-2">
          {definitions.map((d) => (
            <div key={d.kind} className={`card space-y-2 p-5 ${d.status === "planned" ? "opacity-60" : ""}`}>
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-semibold">{d.name}</span>
                <span className="chip font-mono">{d.kind}</span>
                {d.status === "planned" && <span className="chip">準備中</span>}
                <Link href={`/jobs?kind=${d.kind}`} className="ml-auto text-xs text-brand-700 hover:underline">履歴</Link>
              </div>
              <p className="text-[12px] leading-5 text-zinc-600">{d.description}</p>
              <dl className="grid grid-cols-[7rem_1fr] gap-y-1 text-[12px]">
                <dt className="text-zinc-500">起動のしかた</dt><dd>{d.trigger}</dd>
                <dt className="text-zinc-500">実行基盤</dt><dd>{d.runner === "cloud-run-job" ? `Cloud Run Jobs（${d.cloud_run_job} / ${d.region}）` : "このサーバーのスレッド（手元・テスト）"}</dd>
                <dt className="text-zinc-500">時間の上限</dt><dd>{d.timeout_min}分</dd>
                <dt className="text-zinc-500">実行</dt><dd>{d.runs}回（実行中 {d.running}・失敗 {d.failed}）</dd>
                <dt className="text-zinc-500">トークン</dt><dd className="tabular-nums">{f(d.tokens)}</dd>
              </dl>
            </div>
          ))}
        </section>

        <section aria-label="実行履歴" className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="section-title">実行履歴{sp.kind ? `（${sp.kind}）` : ""}</h2>
            {sp.kind && <Link href="/jobs" className="text-xs text-zinc-500 hover:underline">すべて</Link>}
            <span className="ml-auto text-xs text-zinc-500">表示中の合計：入力 {f(sum.i)}・出力 {f(sum.o)} トークン</span>
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="bg-zinc-50 text-left text-zinc-500">
                <tr><th className="px-3 py-2">状態</th><th className="px-3 py-2">ジョブ</th><th className="px-3 py-2">対象</th><th className="px-3 py-2 w-56">進み具合</th>
                  <th className="px-3 py-2">モデル</th><th className="px-3 py-2 text-right">入力</th><th className="px-3 py-2 text-right">出力</th><th className="px-3 py-2">所要</th><th className="px-3 py-2">開始</th></tr>
              </thead>
              <tbody>
                {runs.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-zinc-400">まだ実行がありません</td></tr>}
                {runs.map((r) => (
                  <tr key={r.id} className="border-t border-zinc-100 hover:bg-zinc-50">
                    <td className="px-3 py-2"><JobStatus status={r.status} /></td>
                    <td className="px-3 py-2"><Link href={`/jobs/${r.id}`} className="font-medium hover:underline">{r.name}</Link></td>
                    <td className="px-3 py-2">{(() => { const t = jobTarget(r); return t ? <Link href={t.href} className="hover:underline">{r.product_id ? pname[r.product_id] ?? r.product_id : t.label}</Link> : "—"; })()}</td>
                    <td className="px-3 py-2"><JobProgress job={r} /></td>
                    <td className="px-3 py-2 font-mono text-[11px]">{r.model || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{f(r.usage?.input_tokens ?? 0)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{f(r.usage?.output_tokens ?? 0)}</td>
                    <td className="px-3 py-2">{duration(r.seconds)}</td>
                    <td className="px-3 py-2 text-zinc-500">{when(r.created_at)}<div className="text-[10px]">{r.created_by}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}
