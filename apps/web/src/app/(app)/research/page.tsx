import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { agent, type ResearchLibrary } from "@/lib/agent";
import { auth } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { UserMenu } from "@/components/UserMenu";
import { LibraryForm } from "@/components/knowledge/LibraryForm";
import { createLibrary } from "./actions";

export default async function ResearchPage() {
  const [libs, session] = await Promise.all([agent<ResearchLibrary[]>("/research"), auth()]);
  const canEdit = session?.user?.role !== "VIEWER";
  return (
    <>
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6"><Logo /><UserMenu /></div>
      </header>
      <main className="mx-auto max-w-6xl space-y-8 px-6 py-10">
        <div>
          <Link href="/" className="mb-3 flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900"><ChevronLeft size={14} />すべてのプロダクト</Link>
          <h1 className="text-2xl font-semibold tracking-tight">リサーチライブラリ</h1>
          <p className="mt-1 text-sm text-zinc-500">
            トピックごとに外部の記事・プレス・技術仕様を集め、記事ごとのファクトを抜き出して、論点のまとめと分析に使います。市場分析・競合分析の工程の対話から取り込めます。
          </p>
        </div>
        <section aria-label="ライブラリ" className="grid gap-4 md:grid-cols-2">
          {libs.length === 0 && <p className="text-sm text-zinc-400">まだありません。</p>}
          {libs.map((l) => (
            <Link key={l.number} href={`/research/${l.number}`} className="card block space-y-2 p-5 hover:border-brand-200">
              <div className="flex items-center gap-2"><span className="chip font-mono">{l.key}</span><span className="text-[15px] font-semibold">{l.name}</span></div>
              {l.description && <p className="line-clamp-2 text-[12px] text-zinc-600">{l.description}</p>}
              <div className="flex flex-wrap gap-3 text-[12px] text-zinc-500">
                <span>記事 {l.articles ?? 0}</span><span>ファクト {l.facts ?? 0}</span>
                <span>論点 {l.issues.length}</span><span>最新の記事 {l.latest ?? "—"}</span>
              </div>
            </Link>
          ))}
        </section>
        {canEdit && (
          <section aria-label="新しいライブラリ" className="card max-w-3xl p-5">
            <h2 className="mb-3 text-[15px] font-semibold">新しいライブラリ</h2>
            <LibraryForm action={createLibrary} submit="作る" />
          </section>
        )}
      </main>
    </>
  );
}
