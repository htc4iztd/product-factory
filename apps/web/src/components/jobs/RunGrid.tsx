import Link from "next/link";
import type { JobRun } from "@/lib/agent";
import { TASK_STATUS, JOB_STATUS } from "@/components/autodev/JobBits";

// Airflow のグリッドにあたる：横に実行（古い→新しい）、縦に工程。マスは工程の状態で、押すとその実行へ
export function RunGrid({ runs, title }: { runs: JobRun[]; title: string }) {
  const cols = [...runs].slice(0, 20).reverse();
  const rows: { id: string; name: string; group: string }[] = [];
  const seen = new Set<string>();
  for (const r of [...cols].reverse()) {
    for (const t of r.tasks ?? []) {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        rows.push({ id: t.id, name: t.name, group: t.group.split("：")[0] });
      }
    }
  }
  if (cols.length === 0) return null;
  return (
    <div className="card overflow-x-auto p-4">
      <div className="mb-2 text-[13px] font-semibold">{title}</div>
      <table className="text-[11px]">
        <thead>
          <tr>
            <th />
            {cols.map((r) => {
              const s = JOB_STATUS[r.status];
              return (
                <th key={r.id} className="px-0.5 pb-1 align-bottom">
                  <Link href={`/jobs/${r.id}`} title={`${r.name}・${s?.label ?? r.status}・${new Date(r.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}`}
                    className={`block h-8 w-4 rounded-sm ${r.status === "done" ? "bg-emerald-500" : r.status === "failed" ? "bg-rose-500" : r.status === "running" ? "animate-pulse bg-sky-400" : r.status === "cancelled" ? "bg-amber-300" : "bg-zinc-200"}`} />
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="max-w-[16rem] truncate pr-3 text-zinc-600"><span className="text-zinc-400">{row.group ? `${row.group} ` : ""}</span>{row.name}</td>
              {cols.map((r) => {
                const t = (r.tasks ?? []).find((x) => x.id === row.id);
                const s = t ? TASK_STATUS[t.status] ?? TASK_STATUS.pending : null;
                return (
                  <td key={r.id} className="px-0.5 py-0.5">
                    {t && s ? (
                      <Link href={`/jobs/${r.id}`} title={`${t.name}：${s.label}${t.error ? `（${t.error}）` : ""}`} className={`block h-4 w-4 rounded-sm ${s.dot}`} />
                    ) : <span className="block h-4 w-4" />}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
