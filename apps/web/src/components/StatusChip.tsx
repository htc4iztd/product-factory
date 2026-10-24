import { STATUS_LABEL } from "@/lib/agent";

const COLOR: Record<string, string> = {
  not_started: "bg-gray-100 text-gray-500",
  in_progress: "bg-teal-light text-deep",
  awaiting_approval: "bg-amber-light text-ink border border-amber",
  revising: "bg-amber-light text-ink",
  completed: "bg-teal text-white",
  skipped: "bg-gray-100 text-gray-400",
  needs_recheck: "bg-white text-amber border border-dashed border-amber",
};

export function StatusChip({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${COLOR[status] ?? "bg-gray-100"}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
