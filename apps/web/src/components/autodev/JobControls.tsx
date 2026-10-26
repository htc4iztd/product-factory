"use client";
import { useState, useTransition } from "react";
import { RotateCw, Square } from "lucide-react";
import type { JobRun } from "@/lib/agent";
import { cancelJob, retryAutodev } from "@/app/(app)/p/[id]/autodev-actions";

export function JobControls({ job }: { job: JobRun }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const active = job.status === "queued" || job.status === "running";
  return (
    <div className="flex items-center gap-2">
      {err && <span className="text-xs text-rose-600">{err}</span>}
      {active && !job.cancel_requested && (
        <button type="button" disabled={pending} className="btn-secondary btn-sm"
          onClick={() => confirm("このジョブを取り消しますか？（次の区切りで止まります）") && start(async () => { const r = await cancelJob(job.id); setErr(r.error ?? null); })}>
          <Square size={12} />取り消す
        </button>
      )}
      {!active && job.kind === "autodev" && job.product_id && (
        <button type="button" disabled={pending} className="btn-secondary btn-sm"
          onClick={() => start(async () => { const r = await retryAutodev(job.product_id!, job.id); setErr(r.error ?? null); })}>
          <RotateCw size={12} />同じ条件で作り直す
        </button>
      )}
    </div>
  );
}
