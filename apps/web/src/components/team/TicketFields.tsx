"use client";
import { useState, useTransition } from "react";
import type { Ticket } from "@/lib/agent";
import { TICKET_STATUS } from "./labels";
import { updateTicket } from "@/app/(app)/p/[id]/team-actions";

// チケットの状態・優先度・担当などを、変えたらすぐ保存する
export function TicketFields({ pid, ticket, stages }: { pid: string; ticket: Ticket; stages: { id: string; label: string }[] }) {
  const [t, setT] = useState(ticket);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function save(patch: Partial<Ticket>) {
    setT((x) => ({ ...x, ...patch }));
    start(async () => {
      const r = await updateTicket(pid, t.number, patch);
      setErr(r.error ?? null);
    });
  }
  return (
    <aside className="card h-fit space-y-3 p-4 text-[13px]">
      <div>
        <label className="label" htmlFor="tf-status">状態</label>
        <select id="tf-status" value={t.status} onChange={(e) => save({ status: e.target.value as Ticket["status"] })} className="input">
          {Object.entries(TICKET_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="tf-pri">優先度</label>
        <select id="tf-pri" value={t.priority} onChange={(e) => save({ priority: e.target.value as Ticket["priority"] })} className="input">
          <option>P1</option><option>P2</option><option>P3</option>
        </select>
      </div>
      <div>
        <label className="label" htmlFor="tf-as">担当</label>
        <input id="tf-as" defaultValue={t.assignee ?? ""} onBlur={(e) => e.target.value !== (t.assignee ?? "") && save({ assignee: e.target.value })} className="input" placeholder="メールアドレス" />
      </div>
      <div>
        <label className="label" htmlFor="tf-stage">ステージ</label>
        <select id="tf-stage" value={t.stage_id ?? ""} onChange={(e) => save({ stage_id: e.target.value })} className="input">
          <option value="">—</option>{stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="tf-due">期日</label>
        <input id="tf-due" type="date" defaultValue={t.due ?? ""} onChange={(e) => save({ due: e.target.value })} className="input" />
      </div>
      <div className="h-4 text-[11px]">{pending ? <span className="text-zinc-400">保存中…</span> : err ? <span className="text-rose-600">{err}</span> : null}</div>
    </aside>
  );
}
