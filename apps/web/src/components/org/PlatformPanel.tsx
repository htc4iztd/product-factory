"use client";
import { useState, useTransition } from "react";
import { Check, ShieldAlert, Wrench } from "lucide-react";
import type { PlatformFindingT } from "@/lib/agent";
import { actPlatform, setPlatformFinding } from "@/app/(app)/p/[id]/org-actions";

const when = (t: string | null) => (t ? new Date(t).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const SEV: Record<string, string> = { high: "bg-rose-100 text-rose-800", medium: "bg-amber-100 text-amber-800", low: "bg-zinc-100 text-zinc-600" };
const STATUS: Record<string, string> = { open: "未対応", ack: "対応中", resolved: "解決" };

// 見つかった稼働の問題。対処は PdM が「承認して実行」したものだけ動く
export function FindingList({ pid, findings }: { pid: string; findings: PlatformFindingT[] }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Record<number, string>>({});
  const live = findings.filter((f) => f.status !== "resolved");
  const done = findings.filter((f) => f.status === "resolved");
  const run = (id: number, fn: () => Promise<{ error?: string; done?: string }>) =>
    start(async () => { const r = await fn(); setMsg((m) => ({ ...m, [id]: r.error ?? r.done ?? "" })); });
  return (
    <section className="card" aria-label="稼働の問題">
      <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2.5">
        <ShieldAlert size={15} className="text-rose-600" />
        <h2 className="text-[14px] font-semibold">稼働の問題</h2>
        <span className="text-[11px] text-zinc-500">記録から決まった規則で見つけます（5分ごと・この画面を開いたとき）。見つからなくなったら自動で解決にします</span>
      </div>
      {live.length === 0 && <p className="px-4 py-4 text-[12.5px] text-emerald-700">未対応の問題はありません。</p>}
      <ul className="divide-y divide-zinc-100">
        {live.map((f) => (
          <li key={f.id} className="space-y-1.5 px-4 py-3" data-finding={f.id}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-1.5 text-[10.5px] font-medium ${SEV[f.severity]}`}>{f.severity_label}</span>
              <span className="rounded bg-zinc-100 px-1.5 text-[10.5px] text-zinc-600">{STATUS[f.status]}</span>
              <span className="min-w-0 flex-1 text-[13px] font-medium">{f.title}</span>
              {f.product_name && <span className="text-[11px] text-zinc-500">{f.product_name}</span>}
            </div>
            {f.detail && <p className="whitespace-pre-wrap text-[12px] text-zinc-600">{f.detail}</p>}
            <p className="text-[12px] text-zinc-800"><span className="font-medium text-brand-700">対処の案：</span>{f.suggestion}</p>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
              <span>最初 {when(f.first_at)}・最後 {when(f.last_at)}</span>
              <span className="ml-auto" />
              {f.action && (
                <button className="btn-primary btn-sm" disabled={pending} onClick={() => run(f.id, () => actPlatform(pid, f.id))}>
                  <Wrench size={12} />承認して実行：{f.action.label}
                </button>
              )}
              {f.status === "open" && <button className="btn-secondary btn-sm" disabled={pending} onClick={() => run(f.id, () => setPlatformFinding(pid, f.id, "ack"))}>確かめた</button>}
              <button className="btn-secondary btn-sm" disabled={pending} onClick={() => run(f.id, () => setPlatformFinding(pid, f.id, "resolved"))}><Check size={12} />解決にする</button>
            </div>
            {msg[f.id] && <p className="text-[11.5px] text-zinc-600">{msg[f.id]}</p>}
          </li>
        ))}
      </ul>
      {done.length > 0 && (
        <details className="border-t border-zinc-100 px-4 py-2 text-[12px]">
          <summary className="cursor-pointer text-zinc-500">解決した問題（{done.length}）</summary>
          <ul className="mt-1 space-y-1">
            {done.map((f) => <li key={f.id} className="text-zinc-500">{when(f.resolved_at)}　{f.title}{f.product_name ? `（${f.product_name}）` : ""}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}
