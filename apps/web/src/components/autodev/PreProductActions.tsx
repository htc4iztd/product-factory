"use client";
import { useState, useTransition } from "react";
import { CheckCircle2, RotateCw } from "lucide-react";
import { adoptPreProduct, retryAutodev } from "@/app/(app)/p/[id]/autodev-actions";

export function AdoptButton({ pid, n, adopted }: { pid: string; n: number; adopted: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <>
      <button type="button" disabled={pending} className="btn-primary btn-sm"
        onClick={() => {
          if (!confirm(`PP-${n} の内容を、各ステージの下書きに入れます（いまの下書きは上書きされます）。よろしいですか？`)) return;
          start(async () => { const r = await adoptPreProduct(pid, n); setMsg(r.error ?? "採用しました。各ステージで見直して更新してください"); });
        }}>
        <CheckCircle2 size={12} />{pending ? "採用中…" : adopted ? "もう一度採用する" : "この案を採用する"}
      </button>
      {msg && <span className="basis-full text-xs text-zinc-600">{msg}</span>}
    </>
  );
}

export function RetryButton({ pid, jobId }: { pid: string; jobId: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="ml-auto flex items-center gap-2">
      {err && <span className="text-rose-600">{err}</span>}
      <button type="button" disabled={pending} className="btn-secondary btn-sm"
        onClick={() => start(async () => { const r = await retryAutodev(pid, jobId); setErr(r.error ?? null); })}>
        <RotateCw size={12} />{pending ? "始めています…" : "同じ条件で作り直す"}
      </button>
    </span>
  );
}
