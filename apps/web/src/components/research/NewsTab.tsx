"use client";
import { useMemo, useState, useTransition } from "react";
import { ExternalLink } from "lucide-react";
import type { ResearchData, ResearchQuestion } from "@/lib/agent";
import type { Art, Model } from "./model";
import { addFact, askQuestion, deleteQuestion, retryQuestion, saveMemo, type FactInput } from "@/app/(app)/research/actions";
import { exportDeck } from "./pptx";
import { UpdateButton } from "@/components/knowledge/ResearchBits";

type F = { q: string; seg: "all" | "jp" | "ov" | "new" | "memo" | "qa" | "sel"; cat: string; mon: string };
const F0: F = { q: "", seg: "all", cat: "", mon: "" };
const SEGS: [F["seg"], string][] = [["all", "すべて"], ["jp", "国内"], ["ov", "海外"], ["new", "直近の追加"], ["memo", "メモあり"], ["qa", "質問あり"], ["sel", "選択中"]];
const BASIS: Record<string, [string, string]> = {
  article: ["元記事を読んで回答", "text-emerald-700"], search: ["元記事は開けず、検索で確認して回答", "text-amber-700"],
  none: ["元記事を確認できなかった", "text-amber-700"],
};
const md = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

function Seg<T extends string>({ value, items, onChange }: { value: T; items: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap rounded-md bg-zinc-100 p-0.5" role="group">
      {items.map(([k, l]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}
          className={`rounded px-2 py-1 text-[12px] ${value === k ? "bg-white font-medium text-zinc-900 shadow-card" : "text-zinc-500"}`}>{l}</button>
      ))}
    </div>
  );
}
export { Seg };

function QA({ n, list, canEdit }: { n: number; list: ResearchQuestion[]; canEdit: boolean }) {
  const [pending, start] = useTransition();
  if (!list.length) return null;
  return (
    <div className="space-y-2 rounded-lg border border-sky-100 bg-sky-50/50 p-3">
      {list.map((x) => (
        <div key={x.id} className="space-y-1 text-[12px]">
          <div className="font-medium text-zinc-800">Q. {x.question}</div>
          {x.state === "answered" ? (
            <>
              <div className="whitespace-pre-wrap leading-5 text-zinc-700">{x.answer}</div>
              {x.sources.length > 0 && (
                <ul className="list-disc pl-5 text-[11px]">
                  {x.sources.slice(0, 3).map((s) => <li key={s.u}><a href={s.u} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">{s.t || s.u}</a></li>)}
                </ul>
              )}
            </>
          ) : (
            <div className={x.state === "error" ? "text-rose-700" : "text-zinc-500"} aria-live="polite">
              {x.state === "error" ? `回答できなかった：${x.message || "理由不明"}` : x.state === "running" ? "AI が元記事を読んで回答を書いている…" : "回答を待っている…"}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
            {x.state === "answered" && BASIS[x.basis] && <span className={BASIS[x.basis][1]}>{BASIS[x.basis][0]}</span>}
            <span>{md(x.answered_at ?? x.asked_at)} {x.state === "answered" ? "回答" : "質問"}・{x.asked_by}</span>
            {x.job_id && <a href={`/jobs/${x.job_id}`} className="hover:underline">ジョブ</a>}
            {canEdit && x.state === "error" && <button disabled={pending} onClick={() => start(async () => { await retryQuestion(n, x.id); })} className="text-brand-700 hover:underline">もう一度頼む</button>}
            {canEdit && <button disabled={pending} onClick={() => { if (confirm("この質問と回答を消しますか？")) start(async () => { await deleteQuestion(n, x.id); }); }} className="text-rose-600 hover:underline">消す</button>}
          </div>
        </div>
      ))}
    </div>
  );
}

function FactForm({ n, art, kinds, topics, onDone }: { n: number; art: number; kinds: Record<string, string>; topics: string[]; onDone: () => void }) {
  const [f, setF] = useState<FactInput>({ kind: Object.keys(kinds)[0], theme: topics[0] ?? "", metric: "", value: "", scope: "", source: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof FactInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="grid gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-[12px] md:grid-cols-2" role="group" aria-label="ファクトを追加">
      <label className="space-y-1">種類<select className="input h-8 py-0 text-[12px]" value={f.kind} onChange={set("kind")}>{Object.entries(kinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label className="space-y-1">テーマ<select className="input h-8 py-0 text-[12px]" value={f.theme} onChange={set("theme")}>{topics.map((t) => <option key={t}>{t}</option>)}</select></label>
      <label className="space-y-1">値<input className="input h-8 text-[12px]" value={f.value} onChange={set("value")} placeholder="例：53%" /></label>
      <label className="space-y-1">出典（調査主体）<input className="input h-8 text-[12px]" value={f.source} onChange={set("source")} placeholder="例：調査会社名" /></label>
      <label className="space-y-1 md:col-span-2">何の数字か（主語を入れて）<input className="input h-8 text-[12px]" value={f.metric} onChange={set("metric")} placeholder="例：サービスを週1回以上使う人の割合" /></label>
      <label className="space-y-1 md:col-span-2">対象・範囲<input className="input h-8 text-[12px]" value={f.scope} onChange={set("scope")} placeholder="例：国内、20〜60代3,000人、2026-09" /></label>
      <div className="flex items-center gap-2 md:col-span-2">
        <button disabled={pending} className="btn-primary btn-sm" onClick={() => start(async () => { const r = await addFact(n, art, f); if (r.error) setError(r.error); else onDone(); })}>追加</button>
        <button className="btn-ghost btn-sm" onClick={onDone}>取り消す</button>
        {error && <span className="text-rose-600">{error}</span>}
      </div>
    </div>
  );
}

function ArticleCard({ n, a, M, d, la, sel, onSel, canEdit, onFacts }: {
  n: number; a: Art; M: Model; d: ResearchData; la: string; sel: boolean; onSel: (v: boolean) => void; canEdit: boolean; onFacts: (key: string) => void;
}) {
  const [mode, setMode] = useState<"" | "memo" | "ask" | "fact">("");
  const [memo, setMemo] = useState(a.memo);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fs = M.factsBy[a.key] ?? [];
  const qs = d.questions[a.key] ?? [];
  return (
    <article id={a.key} className={`card scroll-mt-24 space-y-2 p-4 ${sel ? "ring-2 ring-brand-200" : ""}`}>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
        <input type="checkbox" checked={sel} onChange={(e) => onSel(e.target.checked)} aria-label="この記事を選択" />
        <span className="tabular-nums">{a.published ?? "日付不明"}</span>
        {a.added === la && <span className="chip border-brand-200 bg-brand-50 text-brand-700">追加</span>}
        <span className={`chip ${a.jp ? "border-rose-200 bg-rose-50 text-rose-700" : ""}`}>{a.jp ? "国内" : a.country || "海外"}</span>
        <span className="chip">{d.options.categories[a.category] ?? a.category}</span>
        {a.publisher && <span className="font-medium text-zinc-700">{a.publisher}</span>}
        {!a.checked && <span className="chip border-amber-200 text-amber-700" title="本文を開けなかったため、検索結果の文章から要約した。数字はリンク先で確かめてほしい">本文未確認</span>}
        <span className="ml-auto font-mono">{a.key}</span>
      </div>
      <h3 className="text-[15px] font-semibold leading-snug">
        {a.url.startsWith("http") ? <a href={a.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{a.head}<ExternalLink size={11} className="ml-1 inline" /></a> : a.head}
      </h3>
      {a.title_ja && a.title_ja !== a.title && <p className="text-[11px] text-zinc-400">原題：{a.title}</p>}
      <p className="text-[13px] leading-relaxed text-zinc-700">{a.summary}</p>
      {fs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {fs.slice(0, 3).map((f) => <span key={f.key} className="rounded bg-zinc-50 px-2 py-1 text-[12px]"><b className="text-zinc-900">{f.value}</b>　{f.metric}</span>)}
        </div>
      )}
      {(a.iss[0] !== "（論点なし）" || a.ent.length > 0) && (
        <div className="flex flex-wrap gap-1 text-[11px]">
          {a.issues.map((x) => <span key={x} className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-700">{x}</span>)}
          {a.ent.slice(0, 8).map((x) => <span key={x} className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600">{x}</span>)}
        </div>
      )}
      {mode === "memo" ? (
        <div className="space-y-1">
          <textarea className="input min-h-16 text-[12px]" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="この記事について気づいたこと・使いどころ" aria-label="メモ" />
          <div className="flex gap-2">
            <button disabled={pending} className="btn-primary btn-sm" onClick={() => start(async () => { const r = await saveMemo(n, a.number, memo); if (r.error) setError(r.error); else setMode(""); })}>保存</button>
            <button className="btn-ghost btn-sm" onClick={() => { setMemo(a.memo); setMode(""); }}>取り消す</button>
            {a.memo && <button className="btn-ghost btn-sm text-rose-600" onClick={() => start(async () => { await saveMemo(n, a.number, ""); setMemo(""); setMode(""); })}>メモを消す</button>}
          </div>
        </div>
      ) : a.memo ? <p className="whitespace-pre-wrap rounded bg-amber-50 px-3 py-2 text-[12px] text-amber-900">{a.memo}</p> : null}
      <QA n={n} list={qs} canEdit={canEdit} />
      {mode === "ask" && (
        <div className="space-y-1">
          <textarea className="input min-h-16 text-[12px]" maxLength={500} value={q} onChange={(e) => setQ(e.target.value)} aria-label="この記事への質問"
            placeholder="例：この発表で、手数料は誰が負担すると書かれている？" />
          <p className="text-[11px] text-zinc-500">AI が元記事を開いて読み、答えを書きます（ジョブで動きます）。質問と回答はこのライブラリを開ける全員に見えます。</p>
          <div className="flex gap-2">
            <button disabled={pending || !q.trim()} className="btn-primary btn-sm" onClick={() => start(async () => { const r = await askQuestion(n, a.number, q); if (r.error) setError(r.error); else { setQ(""); setMode(""); } })}>質問を送る</button>
            <button className="btn-ghost btn-sm" onClick={() => setMode("")}>取り消す</button>
          </div>
        </div>
      )}
      {mode === "fact" && <FactForm n={n} art={a.number} kinds={d.options.fact_kinds} topics={d.topics} onDone={() => setMode("")} />}
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <div className="flex flex-wrap gap-3 text-[12px]">
        {canEdit && mode !== "memo" && <button className="text-brand-700 hover:underline" onClick={() => setMode("memo")}>{a.memo ? "メモを編集" : "メモを追加"}</button>}
        {canEdit && mode !== "ask" && <button className="text-brand-700 hover:underline" onClick={() => setMode("ask")}>この記事に質問する</button>}
        {fs.length > 0 && <button className="text-brand-700 hover:underline" onClick={() => onFacts(a.key)}>この記事のファクト {fs.length}件</button>}
        {canEdit && mode !== "fact" && <button className="text-brand-700 hover:underline" onClick={() => setMode("fact")}>ファクトを追加</button>}
      </div>
    </article>
  );
}

export function NewsTab({ n, d, M, canEdit, sel, setSel, onFacts }: {
  n: number; d: ResearchData; M: Model; canEdit: boolean; sel: Set<string>; setSel: (s: Set<string>) => void; onFacts: (key: string) => void;
}) {
  const [f, setF] = useState<F>(F0);
  const [msg, setMsg] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const la = M.latestAdded;
  const months = useMemo(() => { const c: Record<string, number> = {}; M.arts.forEach((a) => { c[a.m] = (c[a.m] ?? 0) + 1; }); return c; }, [M]);
  const cats = useMemo(() => { const c: Record<string, number> = {}; M.arts.forEach((a) => { c[a.category] = (c[a.category] ?? 0) + 1; }); return c; }, [M]);
  const q = f.q.trim().toLowerCase();
  const R = M.arts.filter((a) => {
    if (f.seg === "jp" && !a.jp) return false;
    if (f.seg === "ov" && a.jp) return false;
    if (f.seg === "new" && a.added !== la) return false;
    if (f.seg === "memo" && !a.memo) return false;
    if (f.seg === "qa" && !(d.questions[a.key] ?? []).length) return false;
    if (f.seg === "sel" && !sel.has(a.key)) return false;
    if (f.cat && a.category !== f.cat) return false;
    if (f.mon && a.m !== f.mon) return false;
    if (q && !a.txt.includes(q)) return false;
    return true;
  });
  const mk = Object.keys(months).sort();
  const mx = Math.max(1, ...Object.values(months));
  const nJP = M.arts.filter((a) => a.jp).length;
  const toggle = (k: string, v: boolean) => { const s = new Set(sel); if (v) s.add(k); else s.delete(k); setSel(s); };
  let cur = "";
  const grp: Record<string, number> = {};
  R.forEach((a) => { grp[a.m] = (grp[a.m] ?? 0) + 1; });
  const selected = M.arts.filter((a) => sel.has(a.key));

  return (
    <section className="space-y-4">
      {canEdit && (
        <div className="flex justify-end">
          <UpdateButton n={n} scope="articles" label="記事を更新" title="期間の記事を AI の検索・RSS・指定ページから集め、要約とファクトを付ける" />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[[M.arts.length, "記事"], [nJP, "国内"], [M.arts.length - nJP, "海外"], [M.arts.filter((a) => a.added === la).length, `直近の追加（${la ? la.slice(5).replace("-", "/") : "—"}）`]].map(([v, l]) => (
          <div key={String(l)} className="card p-3"><div className="text-xl font-semibold tabular-nums">{v}</div><div className="text-[11px] text-zinc-500">{l}</div></div>
        ))}
      </div>
      {mk.length > 0 && (
        <div aria-label="月ごとの記事数（押すとその月に絞り込み）">
          <div className="flex h-20 items-end gap-0.5">
            {mk.map((k) => (
              <button key={k} type="button" title={`${k}：${months[k]}件`} aria-label={`${k} ${months[k]}件`} onClick={() => setF({ ...f, mon: f.mon === k ? "" : k })}
                className={`max-w-[48px] flex-1 rounded-t ${f.mon === k ? "bg-brand-600" : "bg-brand-200 hover:bg-brand-400"}`} style={{ height: `${(months[k] / mx) * 100}%`, minHeight: 2 }} />
            ))}
          </div>
          <div className="flex gap-0.5 text-[9px] text-zinc-400">
            {mk.map((k, i) => { const m = Number(k.slice(5)); return <span key={k} className="max-w-[48px] flex-1 text-center">{m === 1 || i === 0 ? `${k.slice(2, 4)}/${m}` : m % 3 === 1 ? m : ""}</span>; })}
          </div>
        </div>
      )}
      <div className="sticky top-14 z-[5] flex flex-wrap items-center gap-2 bg-zinc-50/95 py-2 backdrop-blur" role="search">
        <input type="search" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="キーワード（企業名・規格名など）" aria-label="キーワード検索" className="input h-8 w-56 text-[12px]" />
        <Seg value={f.seg} items={SEGS} onChange={(v) => setF({ ...f, seg: v })} />
        <select value={f.cat} onChange={(e) => setF({ ...f, cat: e.target.value })} aria-label="区分" className="input h-8 w-36 py-0 text-[12px]">
          <option value="">区分：すべて</option>{Object.keys(cats).sort((a, b) => cats[b] - cats[a]).map((c) => <option key={c} value={c}>{d.options.categories[c] ?? c}（{cats[c]}）</option>)}
        </select>
        <select value={f.mon} onChange={(e) => setF({ ...f, mon: e.target.value })} aria-label="月" className="input h-8 w-36 py-0 text-[12px]">
          <option value="">月：すべて</option>{mk.slice().reverse().map((k) => <option key={k} value={k}>{k.replace("-", "年")}月（{months[k]}）</option>)}
        </select>
        <button className="text-xs text-zinc-500 hover:underline" onClick={() => setF(F0)}>条件を解除</button>
      </div>
      <p className="text-[12px] text-zinc-500" aria-live="polite">{R.length}件を表示（全{M.arts.length}件）</p>
      {M.arts.length === 0 ? <p className="text-sm text-zinc-400">まだ記事がない。「更新」を押すと記事を集める。手で足すときは「記事を足す」から。</p>
        : R.length === 0 ? <p className="text-sm text-zinc-400">条件に合う記事はない。キーワードや区分を変えるか、「条件を解除」を押してほしい。</p>
        : (
          <div className="space-y-3">
            {R.map((a) => {
              const head = a.m !== cur ? (cur = a.m) : null;
              return (
                <div key={a.key} className="space-y-3">
                  {head && <h2 className="flex items-baseline gap-2 pt-2 text-[15px] font-semibold">{head.replace("-", "年")}月<small className="text-[11px] font-normal text-zinc-400">{grp[head]}件</small></h2>}
                  <ArticleCard n={n} a={a} M={M} d={d} la={la} sel={sel.has(a.key)} onSel={(v) => toggle(a.key, v)} canEdit={canEdit} onFacts={onFacts} />
                </div>
              );
            })}
          </div>
        )}
      {sel.size > 0 && (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 shadow-lg">
          <b className="text-[13px]">{sel.size}件を選択</b>
          <button className="text-[12px] text-brand-700 hover:underline" onClick={() => setSel(new Set([...sel, ...R.map((a) => a.key)]))}>表示中をすべて選択</button>
          <button className="text-[12px] text-brand-700 hover:underline" onClick={() => setSel(new Set())}>選択を解除</button>
          {msg && <span className="text-[12px] text-zinc-500">{msg}</span>}
          <button disabled={exporting} className="btn-primary btn-sm ml-auto" onClick={async () => {
            setExporting(true); setMsg(null);
            try { await exportDeck(d, M, selected); setMsg("保存しました"); } catch (e) { setMsg(`作れませんでした（${String(e)}）`); } finally { setExporting(false); }
          }}>{exporting ? "作っています…" : "PowerPointに出力"}</button>
        </div>
      )}
    </section>
  );
}
