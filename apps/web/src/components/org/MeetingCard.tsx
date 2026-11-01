"use client";
import Link from "next/link";
import { useTransition, useState } from "react";
import { CalendarCheck } from "lucide-react";
import type { DailyMeetingT } from "@/lib/agent";
import { startMeeting } from "@/app/(app)/p/[id]/org-actions";

const STATUS: Record<string, string> = { preparing: "PM がレポートを準備中", open: "開いています", closed: "終わりました", failed: "準備に失敗" };

// 今日の振り返りの会議
export function MeetingCard({ pid, meeting, schedule, pending }: {
  pid: string; meeting: DailyMeetingT | null; schedule: { cron_label: string; next_run_at: string | null; enabled: boolean }; pending: number;
}) {
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <section className="card p-4" aria-label="今日の会議">
      <div className="flex items-center gap-2">
        <CalendarCheck size={16} className="text-brand-600" />
        <h2 className="text-[14px] font-semibold">振り返りの会議</h2>
        <span className="text-[11px] text-zinc-500">{schedule.enabled ? schedule.cron_label : "止めています"}</span>
        <Link href={`/p/${pid}/meetings-daily`} className="ml-auto text-[11px] text-zinc-500 hover:underline">これまでの会議</Link>
      </div>
      {meeting ? (
        <div className="mt-3 flex items-center gap-2 text-[13px]">
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${meeting.status === "open" ? "bg-emerald-100 text-emerald-800" : meeting.status === "preparing" ? "bg-sky-100 text-sky-800" : "bg-zinc-100 text-zinc-600"}`}>{STATUS[meeting.status]}</span>
          <span>{meeting.day} の会議</span>
          {meeting.reviews.some((r) => r.conflict) && <span className="text-[12px] text-rose-600">食い違い {meeting.reviews.filter((r) => r.conflict).length} 件</span>}
          <Link href={`/p/${pid}/meetings-daily/${meeting.id}`} className="btn-primary btn-sm ml-auto">会議に入る</Link>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2 text-[12px] text-zinc-500">
          <span>今日の会議はまだです。PM が集めた未報告のこと：{pending} 件</span>
          <button className="btn-secondary btn-sm ml-auto" disabled={busy} onClick={() => start(async () => { const r = await startMeeting(pid); setMsg(r.error ?? null); })}>
            {busy ? "準備しています…" : "いま会議を始める"}
          </button>
        </div>
      )}
      {msg && <p className="mt-1 text-[11px] text-rose-600">{msg}</p>}
    </section>
  );
}
