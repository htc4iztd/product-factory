import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { agent, type JobRun } from "@/lib/agent";
import { Logo } from "@/components/Logo";
import { UserMenu } from "@/components/UserMenu";
import { AutoRefresh } from "@/components/autodev/AutoRefresh";
import { JobProgress, JobStatus, duration, jobTarget } from "@/components/autodev/JobBits";
import { JobControls } from "@/components/autodev/JobControls";
import { TaskViews } from "@/components/jobs/TaskViews";
import { when } from "@/components/team/RefText";

const f = (n: number) => n.toLocaleString("ja-JP");

export default async function JobPage({ params }: { params: Promise<{ jid: string }> }) {
  const { jid } = await params;
  const j = await agent<JobRun>(`/jobs/${jid}`);
  const active = j.status === "queued" || j.status === "running";
  return (
    <>
      <AutoRefresh active={active} ms={2000} />
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6"><Logo /><UserMenu /></div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-6 py-10">
        <div>
          <Link href="/jobs" className="mb-3 flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900"><ChevronLeft size={14} />ジョブ</Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{j.name}</h1>
            <JobStatus status={j.status} />
            {j.cancel_requested && active && <span className="chip">取り消し待ち</span>}
            <div className="ml-auto"><JobControls job={j} /></div>
          </div>
          <p className="mt-1 font-mono text-xs text-zinc-400">{j.id}</p>
        </div>
        {active && <div className="card p-4"><JobProgress job={j} /></div>}
        {j.error && <p className="rounded-md bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{j.error}</p>}
        <section className="card p-5" aria-label="工程">
          <div className="section-title mb-3">工程</div>
          <TaskViews tasks={j.tasks ?? []} now={Date.now()} />
        </section>
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="card p-5 text-[13px]" aria-label="概要">
            <dl className="grid grid-cols-[8rem_1fr] gap-y-1.5">
              <dt className="text-zinc-500">結果</dt><dd>{jobTarget(j) ? <Link href={jobTarget(j)!.href} className="text-brand-700 hover:underline">{jobTarget(j)!.label}を見る</Link> : "—"}</dd>
              <dt className="text-zinc-500">実行基盤</dt><dd>{j.runner === "cloud-run-job" ? "Cloud Run Jobs" : "スレッド"}{j.execution && <div className="break-all font-mono text-[11px] text-zinc-500">{j.execution}</div>}</dd>
              <dt className="text-zinc-500">モデル</dt><dd className="font-mono text-[12px]">{j.model || "—"}</dd>
              <dt className="text-zinc-500">依頼</dt><dd>{j.created_by}・{when(j.created_at)}</dd>
              <dt className="text-zinc-500">開始・終了</dt><dd>{when(j.started_at)} 〜 {when(j.finished_at)}（{duration(j.seconds)}）</dd>
              {j.retry_of && <><dt className="text-zinc-500">作り直し元</dt><dd><Link href={`/jobs/${j.retry_of}`} className="font-mono text-xs hover:underline">{j.retry_of}</Link></dd></>}
              <dt className="text-zinc-500">入力</dt><dd><pre className="whitespace-pre-wrap break-all text-[11px] text-zinc-600">{JSON.stringify(j.params, null, 2)}</pre></dd>
            </dl>
          </section>
          <section className="card p-5 text-[13px]" aria-label="LLM の使用量">
            <div className="section-title mb-2">LLM の使用量</div>
            <div className="mb-3 grid grid-cols-3 gap-3">
              {[["呼び出し", j.usage?.calls ?? 0], ["入力トークン", j.usage?.input_tokens ?? 0], ["出力トークン", j.usage?.output_tokens ?? 0]].map(([l, v]) => (
                <div key={String(l)} className="rounded-lg bg-zinc-50 p-3"><div className="text-[11px] text-zinc-500">{l}</div><div className="text-lg font-semibold tabular-nums">{f(Number(v))}</div></div>
              ))}
            </div>
            <table className="w-full text-[12px]">
              <thead className="text-left text-zinc-500"><tr><th className="py-1">モデル</th><th className="py-1 text-right">回</th><th className="py-1 text-right">入力</th><th className="py-1 text-right">出力</th></tr></thead>
              <tbody>
                {Object.entries(j.usage?.by_model ?? {}).map(([m, u]) => (
                  <tr key={m} className="border-t border-zinc-100"><td className="py-1 font-mono">{m}</td><td className="py-1 text-right">{u.calls}</td><td className="py-1 text-right tabular-nums">{f(u.input_tokens)}</td><td className="py-1 text-right tabular-nums">{f(u.output_tokens)}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
        <section className="card p-5" aria-label="実行ログ">
          <div className="section-title mb-2">実行ログ</div>
          <ol className="space-y-1 text-[12px]">
            {(j.log ?? []).map((l, i) => (
              <li key={i} className="flex gap-3"><span className="w-24 shrink-0 tabular-nums text-zinc-400">{new Date(l.at).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo" })}</span><span>{l.step}</span></li>
            ))}
            {(j.log ?? []).length === 0 && <li className="text-zinc-400">まだありません</li>}
          </ol>
        </section>
      </main>
    </>
  );
}
