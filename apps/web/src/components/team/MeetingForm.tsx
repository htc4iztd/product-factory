"use client";
import { useActionState } from "react";
import type { MeetingDetail } from "@/lib/agent";
import { saveMeeting } from "@/app/(app)/p/[id]/team-actions";

export function MeetingForm({ pid, meeting: m }: { pid: string; meeting: MeetingDetail }) {
  const [state, run, pending] = useActionState(saveMeeting.bind(null, pid, m.number), undefined);
  return (
    <form action={run} className="card space-y-3 p-5" aria-label="会議の記録">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2"><label className="label" htmlFor="mf-title">会議名</label><input id="mf-title" name="title" defaultValue={m.title} className="input" /></div>
        <div><label className="label" htmlFor="mf-at">日時</label><input id="mf-at" name="starts_at" type="datetime-local" defaultValue={m.starts_at ?? ""} className="input" /></div>
        <div><label className="label" htmlFor="mf-att">参加者</label><input id="mf-att" name="attendees" defaultValue={m.attendees.join(", ")} className="input" /></div>
      </div>
      <div><label className="label" htmlFor="mf-agenda">議題</label><textarea id="mf-agenda" name="agenda" defaultValue={m.agenda} rows={3} className="input" /></div>
      <div>
        <label className="label" htmlFor="mf-tr">文字起こし（会話の記録）</label>
        <textarea id="mf-tr" name="transcript" defaultValue={m.transcript} rows={14} className="input font-mono text-[12px]"
          placeholder={"Meet や Teams の文字起こしを貼り付けます。\n田中: 通知はメールだけでいい？\n佐藤: 決定：最初はメールのみ\n佐藤: 宿題：文面を用意する（sato@example.com）"} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button name="minutes" value="0" disabled={pending} className="btn-secondary btn-sm">保存</button>
        <button name="minutes" value="1" disabled={pending} className="btn-primary btn-sm">{pending ? "処理中…" : "保存して議事録を作る"}</button>
        {state?.error && <span className="text-xs text-rose-600">{state.error}</span>}
      </div>
      <p className="text-[11px] text-zinc-400">議事録を作るたびに、決まったことは決定記録（確定待ち）に、宿題はチケット（仕分け待ち）に追加されます。</p>
    </form>
  );
}
