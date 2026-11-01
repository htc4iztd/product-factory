"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Check, CheckCheck, Inbox, X } from "lucide-react";
import type { ApprovalItem } from "@/lib/agent";
import { decideApprovals } from "@/app/(app)/p/[id]/org-actions";

const when = (t: string) => new Date(t).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

// 承認待ちの案：各エージェントから届いた工程の書き換え案を、ダッシュボードの1か所で承認・否認する
export function ApprovalInbox({ pid, items }: { pid: string; items: ApprovalItem[] }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const run = (keys: string[], accept: boolean) => start(async () => {
    const r = await decideApprovals(pid, keys, accept);
    setMsg(r.error ?? (r.failed?.length ? `できなかったもの：${r.failed.join("／")}` : `${r.done?.length ?? 0} 件を${accept ? "承認しました" : "否認しました"}`));
  });
  const groups = items.reduce<Record<string, ApprovalItem[]>>((g, x) => ({ ...g, [x.stage_id]: [...(g[x.stage_id] ?? []), x] }), {});
  return (
    <section id="approvals" className="card" aria-label="承認待ちの案">
      <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2.5">
        <Inbox size={15} className="text-amber-600" />
        <h2 className="text-[14px] font-semibold">承認待ちの案</h2>
        <span className={`rounded-full px-2 text-[11px] font-medium ${items.length ? "bg-amber-100 text-amber-800" : "bg-zinc-100 text-zinc-500"}`}>{items.length}</span>
        <span className="text-[11px] text-zinc-500">資料の取り込み・定期の仕事などで、各エージェントから届いた工程の書き換え案。承認したものだけ下書きに入ります</span>
        {msg && <span className="ml-auto text-[12px] text-zinc-600" role="status">{msg}</span>}
      </div>
      {items.length === 0 && <p className="px-4 py-3 text-[12.5px] text-zinc-400">承認を待つ案はありません。</p>}
      <div className="divide-y divide-zinc-100">
        {Object.entries(groups).map(([sid, xs]) => (
          <div key={sid} className="px-4 py-3" data-stage={sid}>
            <div className="mb-2 flex items-center gap-2">
              <Link href={`/p/${pid}/s/${sid}`} className="text-[13px] font-semibold hover:underline">{xs[0].stage_label}</Link>
              <span className="text-[11px] text-zinc-500">{xs.length} 件</span>
              {xs.length > 1 && (
                <button className="btn-secondary btn-sm ml-auto" disabled={pending} onClick={() => run(xs.map((x) => x.key), true)}>
                  <CheckCheck size={12} />{xs[0].stage_label}の案をまとめて承認
                </button>
              )}
            </div>
            <ul className="space-y-2">
              {xs.map((x) => (
                <li key={x.key} className="rounded-lg border border-amber-200 bg-white p-2.5" role="group" aria-label={`案：${x.stage_label}「${x.field_label}」`}>
                  <div className="flex flex-wrap items-center gap-x-2 text-[12.5px]">
                    <span className="font-semibold">{x.field_label}</span>
                    <span className="text-[11px] text-zinc-500">{x.source}・{when(x.created_at)}</span>
                  </div>
                  {x.reason && <div className="mt-0.5 text-[11.5px] text-zinc-600">{x.reason}</div>}
                  <div className="mt-1.5 grid gap-1.5 text-[11.5px] md:grid-cols-2">
                    <div><div className="text-[10px] text-zinc-400">変更前</div><div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-zinc-50 px-2 py-1 text-zinc-600">{x.before}</div></div>
                    <div><div className="text-[10px] text-zinc-400">変更後</div><div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-emerald-50 px-2 py-1 text-zinc-900">{x.after}</div></div>
                  </div>
                  <div className="mt-2 flex gap-1.5">
                    <button className="btn-primary btn-sm" disabled={pending} onClick={() => run([x.key], true)}><Check size={12} />承認</button>
                    <button className="btn-secondary btn-sm" disabled={pending} onClick={() => run([x.key], false)}><X size={12} />否認</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
