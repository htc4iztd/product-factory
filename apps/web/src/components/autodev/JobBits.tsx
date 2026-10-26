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

// ジョブの結果を見る場所（ジョブの種類ごと）
export function jobTarget(job: JobRun): { href: string; label: string } | null {
  if (job.kind === "research" && job.params?.number) return { href: `/research/${job.params.number}`, label: `RL-${job.params.number}` };
  if (!job.product_id) return null;
  if (job.kind === "canvas") return { href: `/p/${job.product_id}/canvas`, label: "プロダクト・キャンバス" };
  if (job.kind === "agent") return { href: `/p/${job.product_id}/agents`, label: `AG-${job.params?.agent ?? ""}` };
  if (job.kind === "report") return { href: `/p/${job.product_id}/reports/${job.params?.number ?? ""}`, label: `RP-${job.params?.number ?? ""}` };
  if (job.kind === "import") return { href: `/p/${job.product_id}/import?doc=${job.params?.doc ?? ""}`, label: "資料の取り込み" };
  return { href: `/p/${job.product_id}/preproducts`, label: "プリプロダクト" };
}

// 工程（タスク）の状態の色。グラフ・グリッド・ガントで同じものを使う
export const TASK_STATUS: Record<string, { label: string; dot: string; node: string; bar: string }> = {
  pending: { label: "待ち", dot: "bg-zinc-200", node: "border-zinc-300 bg-white text-zinc-500", bar: "bg-zinc-200" },
  running: { label: "実行中", dot: "bg-sky-400 animate-pulse", node: "border-sky-400 bg-sky-50 text-sky-900", bar: "bg-sky-400 animate-pulse" },
  done: { label: "完了", dot: "bg-emerald-500", node: "border-emerald-400 bg-emerald-50 text-emerald-900", bar: "bg-emerald-500" },
  failed: { label: "失敗", dot: "bg-rose-500", node: "border-rose-400 bg-rose-50 text-rose-900", bar: "bg-rose-500" },
  skipped: { label: "飛ばした", dot: "bg-zinc-300", node: "border-dashed border-zinc-300 bg-zinc-50 text-zinc-400", bar: "bg-zinc-300" },
  cancelled: { label: "取り消し", dot: "bg-amber-300", node: "border-amber-300 bg-amber-50 text-amber-900", bar: "bg-amber-300" },
};

export function TaskLegend() {
  return (
    <div className="flex flex-wrap gap-3 text-[11px] text-zinc-500">
      {Object.entries(TASK_STATUS).map(([k, s]) => (
        <span key={k} className="flex items-center gap-1"><span className={`h-2.5 w-2.5 rounded-sm ${s.dot}`} />{s.label}</span>
      ))}
    </div>
  );
}
