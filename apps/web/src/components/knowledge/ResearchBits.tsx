"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Sparkles, StickyNote } from "lucide-react";
import { analyze, refreshIssues, saveMemo, startUpdate } from "@/app/(app)/research/actions";

export function UpdateButton({ n, busy }: { n: number; busy: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <button disabled={busy || pending} className="btn-primary btn-sm"
        onClick={() => start(async () => { const r = await startUpdate(n); setError(r.error ?? null); })}>
        <RefreshCw size={13} className={busy ? "animate-spin" : ""} />{busy ? "更新中…" : "更新"}
      </button>
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </div>
  );
}

export function MemoEditor({ n, article, memo, canEdit }: { n: number; article: number; memo: string; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(memo);
  const [pending, start] = useTransition();
  if (!open) {
    return (
      <div className="flex items-start gap-1.5">
        {memo && <p className="whitespace-pre-wrap rounded bg-amber-50 px-2 py-1 text-[12px] text-amber-900">{memo}</p>}
        {canEdit && <button onClick={() => setOpen(true)} className="btn-ghost btn-sm h-6 shrink-0 px-1.5 text-[11px]"><StickyNote size={12} />{memo ? "メモを直す" : "メモ"}</button>}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <textarea value={text} onChange={(e) => setText(e.target.value)} className="input min-h-14 text-[12px]" aria-label="メモ" />
      <div className="flex gap-1.5">
        <button disabled={pending} className="btn-primary btn-sm" onClick={() => start(async () => { const r = await saveMemo(n, article, text); if (!r.error) setOpen(false); })}>保存</button>
        <button className="btn-ghost btn-sm" onClick={() => { setText(memo); setOpen(false); }}>やめる</button>
      </div>
    </div>
  );
}

export function RefreshIssues({ n }: { n: number }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      <button disabled={pending} className="btn-secondary btn-sm" onClick={() => start(async () => { const r = await refreshIssues(n); setError(r.error ?? null); })}>
        <Sparkles size={13} />{pending ? "書き直しています…" : "まとめを書き直す"}
      </button>
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </span>
  );
}

export function AnalyzeBox({ n, filters, count }: { n: number; filters: Record<string, string>; count: number }) {
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="card space-y-2 p-4">
      <h3 className="text-[13px] font-semibold">AI に分析を頼む</h3>
      <p className="text-[12px] text-zinc-500">いま絞り込んでいる記事 {count}件とそのファクトだけを根拠に、記事番号・ファクト番号つきのレポートを書きます。</p>
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} className="input flex-1" placeholder="問い（任意）例：利用は広がっているか。何が妨げか" aria-label="問い" />
        <button disabled={pending || count === 0} className="btn-brand btn-sm"
          onClick={() => start(async () => { const r = await analyze(n, q, filters); if (r.error) setError(r.error); else { setQ(""); setError(null); router.refresh(); } })}>
          <Sparkles size={13} />{pending ? "書いています…" : "分析する"}
        </button>
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}
