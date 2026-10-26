import Link from "next/link";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronLeft, Download, ExternalLink } from "lucide-react";
import { agent, type JobDef, type JobRun, type ResearchDetail } from "@/lib/agent";
import { auth } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { UserMenu } from "@/components/UserMenu";
import { ActionForm } from "@/components/team/ActionForm";
import { AutoRefresh } from "@/components/autodev/AutoRefresh";
import { JobProgress, JobStatus } from "@/components/autodev/JobBits";
import { when } from "@/components/team/RefText";
import { LibraryForm } from "@/components/knowledge/LibraryForm";
import { AnalyzeBox, MemoEditor, RefreshIssues, UpdateButton } from "@/components/knowledge/ResearchBits";
import { Pivot } from "@/components/knowledge/Pivot";
import { Bars } from "@/components/knowledge/Bars";
import { addArticle, updateLibrary } from "../actions";

const TABS = { articles: "記事", issues: "論点", facts: "ファクトDB", analysis: "データ分析", players: "企業・団体", add: "記事を足す", settings: "設定" } as const;
type Tab = keyof typeof TABS;
const FILTER_KEYS = ["q", "region", "category", "issue", "entity", "month"] as const;
type SP = Partial<Record<(typeof FILTER_KEYS)[number] | "tab", string>>;

// 本文の RA-n / RF-n を、記事・ファクトの行へのリンクにする
const linkRefs = (md: string) => md.replace(/\b(RA|RF)-(\d+)\b/g, (m, k) => `[${m}](?tab=${k === "RA" ? "articles" : "facts"}#${m})`);

function monthRange(m?: string): { frm?: string; to?: string } {
  return m && /^\d{4}-\d{2}$/.test(m) ? { frm: `${m}-01`, to: `${m}-31` } : {};
}

export default async function LibraryPage({ params, searchParams }: { params: Promise<{ n: string }>; searchParams: Promise<SP> }) {
  const { n: ns } = await params;
  const sp = await searchParams;
  const n = Number(ns);
  const tab: Tab = sp.tab && sp.tab in TABS ? (sp.tab as Tab) : "articles";
  const flt: Record<string, string> = {};
  for (const k of FILTER_KEYS) if (sp[k] && k !== "month") flt[k] = sp[k]!;
  Object.assign(flt, monthRange(sp.month));
  const query = new URLSearchParams(flt).toString();
  const [d, all, jobs, session] = await Promise.all([
    agent<ResearchDetail>(`/research/${n}${query ? `?${query}` : ""}`),
    query ? agent<ResearchDetail>(`/research/${n}`) : null,
    agent<{ definitions: JobDef[]; runs: JobRun[] }>("/jobs?kind=research"),
    auth(),
  ]);
  const base = all ?? d;
  const canEdit = session?.user?.role !== "VIEWER";
  const job = jobs.runs.find((r) => Number(r.params?.number) === n) ?? null;
  const busy = !!job && (job.status === "queued" || job.status === "running");
  const o = d.options;
  // 画面での絞り込み（タブを保ったまま）。API へは月を期間に直して渡す
  const filterForAnalyze = Object.fromEntries(Object.entries(flt).map(([k, v]) => [k === "frm" ? "from" : k, v]));
  const href = (patch: SP) => {
    const q = new URLSearchParams();
    const next = { ...sp, ...patch };
    for (const [k, v] of Object.entries(next)) if (v) q.set(k, v);
    return `?${q.toString()}`;
  };
  const months = base.stats.by_month.map(([m]) => m).reverse();
  const filtered = Object.keys(flt).length > 0;

  return (
    <>
      <AutoRefresh active={busy} />
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6"><Logo /><UserMenu /></div>
      </header>
      <main className="mx-auto max-w-6xl space-y-5 px-6 py-8">
        <div>
          <Link href="/research" className="mb-3 flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900"><ChevronLeft size={14} />リサーチライブラリ</Link>
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2"><span className="chip font-mono">{d.key}</span><h1 className="text-2xl font-semibold tracking-tight">{d.name}</h1></div>
              {d.description && <p className="mt-1 text-sm text-zinc-500">{d.description}</p>}
              <p className="mt-1 text-xs text-zinc-500">
                記事 {d.articles}・ファクト {base.stats.facts}・最新の記事 {d.latest ?? "—"}・次の更新で読む期間：{d.latest ?? d.since ?? "（直近）"} 以降
              </p>
            </div>
            <div className="ml-auto space-y-1 text-right">
              {canEdit && <UpdateButton n={n} busy={busy} />}
              {job && (
                <div className="flex items-center justify-end gap-2 text-[11px] text-zinc-500">
                  <JobStatus status={job.status} />
                  <div className="w-40"><JobProgress job={job} /></div>
                  <Link href={`/jobs/${job.id}`} className="hover:underline">{when(job.created_at)}</Link>
                </div>
              )}
            </div>
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto border-b border-zinc-200" aria-label="タブ">
          {Object.entries(TABS).map(([k, l]) => (
            <Link key={k} href={href({ tab: k })} className={`shrink-0 border-b-2 px-3 py-2 text-[13px] font-medium ${tab === k ? "border-brand-600 text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-800"}`}>{l}</Link>
          ))}
        </nav>

        {["articles", "facts", "analysis", "players"].includes(tab) && (
          <form className="flex flex-wrap items-center gap-2" aria-label="絞り込み">
            <input type="hidden" name="tab" value={tab} />
            <input name="q" defaultValue={sp.q} placeholder="題名・要約で探す" className="input h-8 w-44 py-0 text-[12px]" aria-label="キーワード" />
            <select name="region" defaultValue={sp.region ?? ""} className="input h-8 w-28 py-0 text-[12px]" aria-label="地域">
              <option value="">地域：すべて</option>{Object.entries(o.regions).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <select name="category" defaultValue={sp.category ?? ""} className="input h-8 w-32 py-0 text-[12px]" aria-label="区分">
              <option value="">区分：すべて</option>{Object.entries(o.categories).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <select name="month" defaultValue={sp.month ?? ""} className="input h-8 w-32 py-0 text-[12px]" aria-label="月">
              <option value="">月：すべて</option>{months.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <select name="issue" defaultValue={sp.issue ?? ""} className="input h-8 w-36 py-0 text-[12px]" aria-label="論点">
              <option value="">論点：すべて</option>{d.issues.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
            <select name="entity" defaultValue={sp.entity ?? ""} className="input h-8 w-36 py-0 text-[12px]" aria-label="企業・団体">
              <option value="">企業・団体：すべて</option>{base.stats.by_entity.map(([x]) => <option key={x} value={x}>{x}</option>)}
            </select>
            <button className="btn-secondary btn-sm">絞り込む</button>
            {filtered && <Link href={`?tab=${tab}`} className="text-xs text-zinc-500 hover:underline">条件を解除</Link>}
            <span className="ml-auto text-xs text-zinc-500">表示中：記事 {d.stats.articles}・ファクト {d.stats.facts}</span>
          </form>
        )}

        {tab === "articles" && (
          <section aria-label="記事" className="space-y-3">
            {d.items.length === 0 && <p className="text-sm text-zinc-400">{d.articles ? "条件に合う記事がありません" : "まだ記事がありません。「更新」で集めるか、「記事を足す」から URL か本文を入れてください。"}</p>}
            {d.items.map((a) => (
              <article key={a.number} id={a.key} className="card scroll-mt-20 space-y-1.5 p-4">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                  <span className="chip font-mono">{a.key}</span>
                  <span>{a.published ?? "日付不明"}</span><span>{o.regions[a.region] ?? a.region}</span><span>{o.categories[a.category] ?? a.category}</span>
                  {a.publisher && <span>{a.publisher}</span>}
                  <span className="ml-auto">{a.origin === "manual" ? "手で追加" : a.origin === "search" ? "AI の検索" : "RSS・サイト"}</span>
                </div>
                <h2 className="text-[14px] font-semibold leading-snug">
                  {a.url.startsWith("http") ? <a href={a.url} target="_blank" rel="noreferrer noopener" className="hover:underline">{a.title}<ExternalLink size={11} className="ml-1 inline" /></a> : a.title}
                </h2>
                <p className="text-[13px] leading-relaxed text-zinc-700">{a.summary}</p>
                <div className="flex flex-wrap gap-1">
                  {a.issues.map((x) => <Link key={x} href={href({ issue: x })} className="chip hover:border-brand-200">論点：{x}</Link>)}
                  {a.entities.map((x) => <Link key={x} href={href({ entity: x })} className="chip hover:border-brand-200">{x}</Link>)}
                </div>
                <MemoEditor n={n} article={a.number} memo={a.memo} canEdit={canEdit} />
              </article>
            ))}
          </section>
        )}

        {tab === "issues" && (
          <section aria-label="論点" className="space-y-4">
            <div className="flex items-center gap-2">
              <p className="text-[12px] text-zinc-500">論点ごとのまとめです。新しい記事が3件たまると、更新のときに書き直します。</p>
              {canEdit && <span className="ml-auto"><RefreshIssues n={n} /></span>}
            </div>
            {d.issues.length === 0 && <p className="text-sm text-zinc-400">論点が決まっていません。「設定」で足してください。</p>}
            {d.issues.map((x) => {
              const note = base.issue_notes[x];
              return (
                <div key={x} className="card space-y-2 p-4">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[14px] font-semibold">{x}</h2>
                    <Link href={href({ tab: "articles", issue: x })} className="text-xs text-brand-700 hover:underline">記事を見る</Link>
                    {note && <span className="ml-auto text-[11px] text-zinc-400">{note.articles}件の記事から・{when(note.created_at)}</span>}
                  </div>
                  {note ? <div className="prose-md"><Markdown remarkPlugins={[remarkGfm]}>{linkRefs(note.body)}</Markdown></div> : <p className="text-[12px] text-zinc-400">まだまとめがありません。</p>}
                </div>
              );
            })}
          </section>
        )}

        {tab === "facts" && (
          <section aria-label="ファクトDB" className="space-y-2">
            <div className="flex items-center gap-2">
              <p className="text-[12px] text-zinc-500">記事から抜き出した数字と事実です。「原文確認」は、引用が記事の本文にそのまま見つかったものです。</p>
              <a href={`/api/research/${n}/facts?${query}`} className="btn-secondary btn-sm ml-auto"><Download size={13} />CSVで保存</a>
            </div>
            <div className="card overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="bg-zinc-50 text-left text-zinc-500">
                  <tr><th className="px-3 py-2">ID</th><th className="px-3 py-2">日付</th><th className="px-3 py-2">種類</th><th className="px-3 py-2">テーマ</th><th className="px-3 py-2">何の数字か</th>
                    <th className="px-3 py-2">値</th><th className="px-3 py-2">対象・範囲</th><th className="px-3 py-2">出典</th><th className="px-3 py-2">記事</th><th className="px-3 py-2">原文確認</th></tr>
                </thead>
                <tbody>
                  {d.facts.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-zinc-400">ファクトがありません</td></tr>}
                  {d.facts.map((f) => (
                    <tr key={f.number} id={f.key} className="scroll-mt-20 border-t border-zinc-100 align-top">
                      <td className="px-3 py-2 font-mono text-[11px]">{f.key}</td>
                      <td className="whitespace-nowrap px-3 py-2">{f.date ?? "—"}</td>
                      <td className="px-3 py-2">{o.fact_kinds[f.kind] ?? f.kind}</td>
                      <td className="px-3 py-2">{f.theme}</td>
                      <td className="px-3 py-2" title={f.quote}>{f.metric}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-semibold">{f.value}</td>
                      <td className="px-3 py-2 text-zinc-600">{f.scope}</td>
                      <td className="px-3 py-2 text-zinc-600">{f.source}</td>
                      <td className="px-3 py-2"><Link href={`?tab=articles#${f.article}`} className="font-mono text-[11px] text-brand-700 hover:underline">{f.article}</Link></td>
                      <td className="px-3 py-2">{f.verified ? "✓" : <span className="text-amber-700">未確認</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === "analysis" && (
          <section aria-label="データ分析" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="card space-y-2 p-4"><h3 className="text-[13px] font-semibold">区分</h3><Bars rows={d.stats.by_category} labels={o.categories} /></div>
              <div className="card space-y-2 p-4"><h3 className="text-[13px] font-semibold">地域</h3><Bars rows={d.stats.by_region} labels={o.regions} /></div>
              <div className="card space-y-2 p-4"><h3 className="text-[13px] font-semibold">ファクトの種類</h3><Bars rows={d.stats.by_fact_kind} labels={o.fact_kinds} /></div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="card space-y-2 p-4">
                <h3 className="text-[13px] font-semibold">推移と増減（月ごとの記事数）</h3>
                <Bars rows={d.stats.by_month} />
                {d.stats.by_month.length >= 2 && (() => {
                  const [a, b] = d.stats.by_month.slice(-2);
                  const diff = b[1] - a[1];
                  return <p className="text-[12px] text-zinc-500">{b[0]} は前の月（{a[0]}）より {diff >= 0 ? `${diff}件多い` : `${-diff}件少ない`}</p>;
                })()}
              </div>
              <div className="card space-y-2 p-4"><h3 className="text-[13px] font-semibold">論点</h3><Bars rows={d.stats.by_issue} /></div>
            </div>
            <Pivot facts={d.facts} kinds={o.fact_kinds} regions={o.regions} />
            {canEdit && <AnalyzeBox n={n} filters={filterForAnalyze} count={d.stats.articles} />}
            {base.analyses.map((a) => (
              <div key={a.id} className="card space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[14px] font-semibold">{a.title}</h3>
                  {Object.entries(a.filters).map(([k, v]) => <span key={k} className="chip">{k}：{v}</span>)}
                  <span className="ml-auto text-[11px] text-zinc-400">{a.created_by}・{when(a.created_at)}</span>
                </div>
                <div className="prose-md"><Markdown remarkPlugins={[remarkGfm]}>{linkRefs(a.body)}</Markdown></div>
              </div>
            ))}
          </section>
        )}

        {tab === "players" && (
          <section aria-label="企業・団体" className="grid gap-4 md:grid-cols-2">
            <div className="card space-y-2 p-4"><h3 className="text-[13px] font-semibold">記事に出てくる企業・団体</h3><Bars rows={d.stats.by_entity} /></div>
            <div className="space-y-2">
              {d.stats.by_entity.slice(0, 12).map(([e]) => {
                const arts = d.items.filter((a) => a.entities.includes(e));
                return (
                  <div key={e} className="card p-3">
                    <div className="flex items-center gap-2"><Link href={href({ tab: "articles", entity: e })} className="text-[13px] font-semibold hover:underline">{e}</Link><span className="text-[11px] text-zinc-400">{arts.length}件</span></div>
                    <ul className="mt-1 space-y-0.5 text-[12px] text-zinc-600">
                      {arts.slice(0, 3).map((a) => <li key={a.number} className="truncate">{a.published ?? ""} {a.title}</li>)}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {tab === "add" && (
          <section aria-label="記事を足す" className="card max-w-3xl space-y-3 p-5">
            <p className="text-[12px] text-zinc-500">URL だけなら本文を取りに行きます（公開されているページだけ）。ログインが要るページや PDF は、本文を貼ってください。</p>
            {canEdit ? (
              <ActionForm action={addArticle.bind(null, n)} submit="足す" pendingLabel="読んでいます…">
                <input name="url" className="input" placeholder="https://…" aria-label="URL" />
                <input name="title" className="input" placeholder="題名（本文を貼るとき）" aria-label="題名" />
                <textarea name="text" className="input min-h-40" placeholder="本文（任意）" aria-label="本文" />
              </ActionForm>
            ) : <p className="text-sm text-zinc-400">閲覧のみの権限では足せません。</p>}
          </section>
        )}

        {tab === "settings" && (
          <section aria-label="設定" className="card max-w-3xl p-5">
            {canEdit ? <LibraryForm action={updateLibrary.bind(null, n)} lib={d} submit="保存" /> : <p className="text-sm text-zinc-400">閲覧のみの権限では変えられません。</p>}
          </section>
        )}
      </main>
    </>
  );
}
