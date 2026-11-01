"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Send } from "lucide-react";
import { type AgentIssueT } from "@/lib/agent";
import { PM_KEYS, PM_NAME } from "@/lib/pm";
import { createIssue, updateIssue } from "@/app/(app)/p/[id]/org-actions";

export const TRACKERS = { task: "タスク", feature: "機能", bug: "バグ", question: "質問", support: "サポート" };
export const STATUSES = { new: "新規", in_progress: "進行中", resolved: "解決", feedback: "フィードバック", closed: "終了", rejected: "却下" };
export const PRIORITIES = { low: "低め", normal: "通常", high: "高め", urgent: "急いで", immediate: "今すぐ" };

// PdM が起票できるのは PM 宛てだけ（担当には PM が振る）
export function NewIssue({ pid }: { pid: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ assignee: "pm_biz", subject: "", description: "", tracker: "task", priority: "normal", due_date: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open) return <button className="btn-primary" onClick={() => setOpen(true)}><Plus size={14} />新しい Issue（PM 宛て）</button>;
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <div className="card w-full space-y-2 p-4 text-[13px]">
      <div className="grid gap-2 md:grid-cols-4">
        <label className="block"><span className="label">宛先（PM まで）</span>
          <select className="input" value={f.assignee} aria-label="宛先" onChange={(e) => set("assignee", e.target.value)}>
            {PM_KEYS.map((k) => <option key={k} value={k}>{PM_NAME[k]}</option>)}
          </select></label>
        <label className="block"><span className="label">トラッカー</span>
          <select className="input" value={f.tracker} onChange={(e) => set("tracker", e.target.value)}>
            {Object.entries(TRACKERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
        <label className="block"><span className="label">優先度</span>
          <select className="input" value={f.priority} onChange={(e) => set("priority", e.target.value)}>
            {Object.entries(PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
        <label className="block"><span className="label">期日</span>
          <input type="date" className="input" value={f.due_date} onChange={(e) => set("due_date", e.target.value)} /></label>
      </div>
      <label className="block"><span className="label">題名</span><input className="input" value={f.subject} aria-label="題名" onChange={(e) => set("subject", e.target.value)} /></label>
      <label className="block"><span className="label">説明</span><textarea className="input" rows={4} value={f.description} aria-label="説明" onChange={(e) => set("description", e.target.value)} /></label>
      {error && <p className="text-[12px] text-rose-600">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary btn-sm" disabled={pending || !f.subject.trim()} onClick={() => start(async () => {
          const r = await createIssue(pid, { ...f, due_date: f.due_date || null });
          if (r.error) setError(r.error); else { setOpen(false); router.push(`/p/${pid}/issues/${r.number}`); }
        })}>起票する</button>
        <button className="btn-ghost btn-sm" onClick={() => setOpen(false)}>やめる</button>
      </div>
    </div>
  );
}

// PdM が書き込めるのは PM が担当の Issue だけ
export function IssueReply({ pid, issue }: { pid: string; issue: AgentIssueT }) {
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState(issue.status);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="card space-y-2 p-4">
      <div className="text-[13px] font-semibold">注記を書く（{issue.assignee_name}が受け取ります）</div>
      <textarea className="input text-[13px]" rows={3} value={notes} aria-label="注記" onChange={(e) => setNotes(e.target.value)} />
      <div className="flex items-center gap-2">
        <select className="input h-8 w-auto py-0 text-[12px]" value={status} aria-label="状態" onChange={(e) => setStatus(e.target.value as AgentIssueT["status"])}>
          {Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="btn-primary btn-sm" disabled={pending || (!notes.trim() && status === issue.status)} onClick={() => start(async () => {
          const r = await updateIssue(pid, issue.number, { notes, status });
          if (r.error) setError(r.error); else { setNotes(""); setError(null); }
        })}><Send size={12} />更新する</button>
        {error && <span className="text-[12px] text-rose-600">{error}</span>}
      </div>
    </div>
  );
}
