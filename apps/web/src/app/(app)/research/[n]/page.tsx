import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { agent, type JobDef, type JobRun, type ResearchData } from "@/lib/agent";
import { auth } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { UserMenu } from "@/components/UserMenu";
import { ActionForm } from "@/components/team/ActionForm";
import { AutoRefresh } from "@/components/autodev/AutoRefresh";
import { JobProgress } from "@/components/autodev/JobBits";
import { LibraryForm } from "@/components/knowledge/LibraryForm";
import { UpdateButton } from "@/components/knowledge/ResearchBits";
import { ResearchApp, TABS, type Tab } from "@/components/research/ResearchApp";
import { addArticle, updateLibrary } from "../actions";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

export default async function LibraryPage({ params, searchParams }: { params: Promise<{ n: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { n: ns } = await params;
  const sp = await searchParams;
  const n = Number(ns);
  const [d, jobs, session] = await Promise.all([
    agent<ResearchData>(`/research/${n}/data`),
    agent<{ definitions: JobDef[]; runs: JobRun[] }>("/jobs?kind=research"),
    auth(),
  ]);
  const canEdit = session?.user?.role !== "VIEWER";
  const job = jobs.runs.find((r) => Number(r.params?.number) === n) ?? null;
  const busy = !!job && (job.status === "queued" || job.status === "running");
  // 質問の回答や調査レポートを待っている間も、数秒ごとに取り直す
  const waiting = busy || Object.values(d.questions).flat().some((q) => q.state === "pending" || q.state === "running")
    || d.reports.some((r) => r.status === "queued" || r.status === "running");
  const initial: Tab = sp.tab && sp.tab in TABS ? (sp.tab as Tab) : "news";
  return (
    <>
      <AutoRefresh active={waiting} ms={4000} />
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6"><Logo /><UserMenu /></div>
      </header>
      <main className="mx-auto max-w-7xl space-y-5 px-6 py-8">
        <div>
          <Link href="/research" className="mb-3 flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900"><ChevronLeft size={14} />リサーチライブラリ</Link>
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2"><span className="chip font-mono">{d.key}</span><h1 className="text-2xl font-semibold tracking-tight">{d.name}</h1></div>
              {d.description && <p className="mt-1 max-w-4xl text-sm leading-relaxed text-zinc-600">{d.description}</p>}
            </div>
            <div className="w-72 space-y-1 text-right">
              {canEdit && <div className="flex justify-end"><UpdateButton n={n} busy={busy} /></div>}
              <p className="text-[11px] text-zinc-500" aria-live="polite">
                {busy ? "更新しています。終わると自動で反映される。" : `前回の更新 ${when(d.updated_at)}・次は ${d.latest ?? d.since ?? "直近"} より後の記事を集める`}
              </p>
              {job && busy && <a href={`/jobs/${job.id}`} className="block"><JobProgress job={job} /></a>}
              {job && !busy && job.status === "failed" && <a href={`/jobs/${job.id}`} className="block text-[11px] text-rose-600 hover:underline">前回の更新は失敗：{job.error}</a>}
            </div>
          </div>
        </div>
        <ResearchApp d={d} canEdit={canEdit} initial={initial}
          add={(
            <section aria-label="記事を足す" className="card max-w-3xl space-y-3 p-5">
              <p className="text-[12px] text-zinc-500">URL だけなら本文を取りに行く（公開されているページだけ）。ログインが要るページや PDF は本文を貼ってほしい。AI が要約・論点・企業・ファクトを付ける。</p>
              <ActionForm action={addArticle.bind(null, n)} submit="足す" pendingLabel="読んでいます…">
                <input name="url" className="input" placeholder="https://…" aria-label="URL" />
                <input name="title" className="input" placeholder="題名（本文を貼るとき）" aria-label="題名" />
                <textarea name="text" className="input min-h-40" placeholder="本文（任意）" aria-label="本文" />
              </ActionForm>
            </section>
          )}
          settings={<section aria-label="設定" className="card max-w-3xl p-5"><LibraryForm action={updateLibrary.bind(null, n)} lib={d} submit="保存" /></section>} />
        <footer className="space-y-1 border-t border-zinc-200 pt-4 text-[11px] leading-5 text-zinc-500">
          <p>「論点」のまとめは記事の要約だけを根拠に AI が書いたもので、「更新」で新しい記事が3件以上入った論点は書き直される。「技術調査」「業界調査」「公的データ」は AI が公開資料を読んでまとめたもので、各レポートに出典と確認日を付けている。</p>
          <p>選んだ記事は「PowerPointに出力」で一覧と1記事1枚のスライドにして保存できる（メモとファクトも入り、質問と回答はノートに入る）。メモ・質問・回答はこのライブラリを開ける全員に見える。</p>
          <p>「更新」を押すと、前回の最新記事より後に出た記事を AI の検索・RSS・指定ページから集め、ファクトも抜き出す。プレーヤーの最新の動きも書き換える。AI の検索は、Claude の接続なら Claude が期間を区切って Web 検索を繰り返し（見つけた記事を伝えて、まだ見つけていない記事を探し直す）、Gemini の接続でも同じく期間を区切って Google 検索で探し直す（論点・企業の切り口でも探す）。本文を開けなかった記事（ボット除け・有料記事など）は検索結果の文章から要約し、「本文未確認」の印を付ける。期間の始まりを決めていれば毎回そこから探し、集めた記事は URL で重ねない。数分〜十数分かかり、終わると自動で反映される。</p>
        </footer>
      </main>
    </>
  );
}
