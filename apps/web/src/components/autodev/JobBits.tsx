import type { JobRun } from "@/lib/agent";

export const JOB_STATUS: Record<string, { label: string; cls: string }> = {
  queued: { label: "待機中", cls: "border-zinc-200 text-zinc-500" },
  running: { label: "実行中", cls: "border-sky-200 bg-sky-50 text-sky-700" },
  done: { label: "完了", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  failed: { label: "失敗", cls: "border-rose-200 bg-rose-50 text-rose-700" },
  cancelled: { label: "取り消し", cls: "border-zinc-200 text-zinc-400" },
};

export function JobStatus({ status }: { status: string }) {
  const s = JOB_STATUS[status] ?? { label: status, cls: "" };
  return <span className={`chip ${s.cls}`}>{s.label}</span>;
}

export function JobProgress({ job }: { job: JobRun }) {
  const p = job.progress;
  if (!p) return null;
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100">
        <div className={`h-full rounded-full ${job.status === "failed" ? "bg-rose-400" : "bg-brand-500"} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between text-[11px] text-zinc-500"><span className="truncate">{p.step}</span><span className="tabular-nums">{p.done}/{p.total}</span></div>
    </div>
  );
}

export function tokens(job: JobRun): string {
  const u = job.usage;
  if (!u) return "—";
  const f = (n: number) => n.toLocaleString("ja-JP");
  return `入力 ${f(u.input_tokens)}・出力 ${f(u.output_tokens)}（${u.calls}回）`;
}

export function duration(sec: number | null): string {
  if (sec == null) return "—";
  return sec < 60 ? `${sec}秒` : `${Math.floor(sec / 60)}分${sec % 60}秒`;
}
