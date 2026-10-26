"use client";
import { useState } from "react";
import type { ResearchData } from "@/lib/agent";
import { type Model, pct, periods } from "./model";
import { RefreshIssues } from "@/components/knowledge/ResearchBits";

const STANCE: Record<string, string> = { 推進: "bg-emerald-50 text-emerald-700", 慎重: "bg-rose-50 text-rose-700", 中立: "bg-zinc-100 text-zinc-600" };

// 根拠の記事番号を [1][2] のリンクにする（題名は押す前に出る）
export function Refs({ nums, M }: { nums: number[]; M: Model }) {
  return (
    <span className="ml-1 inline-flex gap-0.5 align-super text-[10px]">
      {nums.map((n, i) => {
        const a = M.byNum[n];
        if (!a) return null;
        return <a key={n} href={a.url.startsWith("http") ? a.url : `#${a.key}`} target="_blank" rel="noopener noreferrer"
          title={`${a.key} ${a.published ?? ""} ${a.publisher}：${a.head}`} className="text-brand-700 hover:underline">[{i + 1}]</a>;
      })}
    </span>
  );
}

export function IssuesTab({ n, d, M, canEdit }: { n: number; d: ResearchData; M: Model; canEdit: boolean }) {
  const [sort, setSort] = useState<"n" | "o">("n");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const count = (x: string) => M.arts.filter((a) => a.issues.includes(x)).length;
  const keys = [...M.issues].sort((a, b) => (sort === "n" ? count(b) - count(a) : M.issues.indexOf(a) - M.issues.indexOf(b)));
  const per = periods(M.arts, "q");
  if (!M.issues.length) return <p className="text-sm text-zinc-400">論点が決まっていません。「設定」で足してください（「論点名｜その論点で問うこと」と書けます）。</p>;
  return (
    <section className="space-y-4">
      <p className="text-[13px] text-zinc-500">記事に付けた{M.issues.length}の論点ごとに、記事群が主に何を主張・報告しているかをまとめた。番号を押すと根拠の記事を開く。まとめは記事の要約だけを根拠にしていて、新しい記事が3件以上入った論点は「更新」のときに書き直す。</p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md bg-zinc-100 p-0.5">
          {([["n", "記事の多い順"], ["o", "設定の順"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setSort(k)} className={`rounded px-2 py-1 text-[12px] ${sort === k ? "bg-white font-medium shadow-card" : "text-zinc-500"}`}>{l}</button>
          ))}
        </div>
        <nav className="flex flex-wrap gap-1" aria-label="論点へ移動">
          {keys.map((k) => <a key={k} href={`#iss-${encodeURIComponent(k)}`} className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] text-zinc-600 hover:border-brand-200">{k}（{count(k)}）</a>)}
        </nav>
        {canEdit && <span className="ml-auto"><RefreshIssues n={n} /></span>}
      </div>
      {keys.map((k) => {
        const note = d.issue_notes[k];
        const S = note?.data;
        const mine = M.arts.filter((a) => a.issues.includes(k));
        const pc: Record<string, number> = {};
        mine.forEach((a) => { pc[a.q] = (pc[a.q] ?? 0) + 1; });
        const pm = Math.max(1, ...Object.values(pc));
        return (
          <article key={k} id={`iss-${encodeURIComponent(k)}`} className="card scroll-mt-24 space-y-3 p-5">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-[16px] font-semibold">{k}</h3>
                {M.issueQ[k] && <p className="text-[12px] text-zinc-500">{M.issueQ[k]}</p>}
              </div>
              <div className="text-right text-[11px] text-zinc-500">
                {mine.length}記事（全体の{M.arts.length ? pct(mine.length / M.arts.length) : "—"}）
                <div className="mt-1 flex h-6 items-end justify-end gap-px" role="img" aria-label="四半期ごとの記事数">
                  {per.map((p) => <i key={p} title={`${p}：${pc[p] ?? 0}件`} className="block w-1.5 rounded-sm bg-violet-300" style={{ height: `${((pc[p] ?? 0) / pm) * 100}%`, minHeight: 1 }} />)}
                </div>
              </div>
            </div>
            {!S ? (
              <p className="text-[12px] text-zinc-400">{note ? "（以前の形式のまとめ）" : "まだまとめがない。記事が入ると「更新」のときに書く（「まとめを書き直す」でもすぐに書ける）。"}</p>
            ) : (
              <>
                <p className="text-[14px] font-medium leading-relaxed">{S.headline}</p>
                <ul className="space-y-1.5">
                  {S.claims.map((c, i) => (
                    <li key={i} className="flex gap-2 text-[13px] leading-relaxed">
                      <span className={`mt-0.5 h-fit shrink-0 rounded px-1.5 py-0.5 text-[10px] ${STANCE[c.stance] ?? STANCE["中立"]}`}>{c.stance || "中立"}</span>
                      <span>{c.text}<Refs nums={c.refs} M={M} /></span>
                    </li>
                  ))}
                </ul>
                <div className="grid gap-2 text-[12px] md:grid-cols-2">
                  {S.counter && <div className="rounded-lg bg-rose-50/60 p-3"><b className="mb-1 block text-rose-800">反対・慎重な見方、反証</b>{S.counter}<Refs nums={S.counter_refs} M={M} /></div>}
                  {S.domestic && <div className="rounded-lg bg-zinc-50 p-3"><b className="mb-1 block">国内の記事</b>{S.domestic}<Refs nums={S.domestic_refs} M={M} /></div>}
                  {S.shift && <div className="rounded-lg bg-zinc-50 p-3 md:col-span-2"><b className="mb-1 block">時期による変化</b>{S.shift}</div>}
                </div>
                <p className="text-[11px] text-zinc-400">{note.articles}件の記事から・{new Date(note.created_at).toLocaleDateString("ja-JP")}</p>
              </>
            )}
            <button className="text-[12px] text-brand-700 hover:underline" onClick={() => setOpen({ ...open, [k]: !open[k] })}>{open[k] ? "記事の一覧を閉じる" : `この論点の記事を一覧（${mine.length}件）`}</button>
            {open[k] && (
              <ol className="list-decimal space-y-1 pl-5 text-[12px]">
                {mine.map((a) => <li key={a.key}><span className="tabular-nums text-zinc-400">{a.published}</span> {a.publisher}：<a href={a.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{a.head}</a></li>)}
              </ol>
            )}
          </article>
        );
      })}
    </section>
  );
}
