import { STATUS_LABEL } from "@/lib/agent";

const STYLE: Record<string, { dot: string; text: string; bg: string }> = {
  not_started: { dot: "bg-zinc-300", text: "text-zinc-500", bg: "bg-zinc-100" },
  in_progress: { dot: "bg-sky-500", text: "text-sky-700", bg: "bg-sky-50" },
  awaiting_approval: { dot: "bg-amber-500", text: "text-amber-800", bg: "bg-amber-50" },
  revising: { dot: "bg-violet-500", text: "text-violet-700", bg: "bg-violet-50" },
  completed: { dot: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50" },
  needs_recheck: { dot: "bg-rose-500", text: "text-rose-700", bg: "bg-rose-50" },
  skipped: { dot: "bg-zinc-300", text: "text-zinc-400", bg: "bg-zinc-100" },
};

export function StatusDot({ status, enabled = true }: { status: string; enabled?: boolean }) {
  const s = STYLE[status] ?? STYLE.not_started;
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${enabled ? s.dot : "border border-zinc-300 bg-transparent"}`} />;
}

export function StatusBadge({ status, enabled = true }: { status: string; enabled?: boolean }) {
  if (!enabled) return <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-400">閉じている</span>;
  const s = STYLE[status] ?? STYLE.not_started;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${s.bg} ${s.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
