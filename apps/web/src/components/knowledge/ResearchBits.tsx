"use client";
import { useState, useTransition } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import { refreshIssues, startUpdate } from "@/app/(app)/research/actions";

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
