"use client";
import { useState, useTransition } from "react";
import { Play } from "lucide-react";
import { runTeam } from "@/app/(app)/p/[id]/org-actions";

// 掲示板の目的（新しい形は確認・回答・共有。古い投稿の目的もそのまま読めるように）
export const INTENT_LABEL: Record<string, string> = {
  confirm: "確認", answer: "回答", notice: "共有", report: "報告", request: "依頼", decision: "決定", directive: "指示", question: "質問",
};
export const INTENT_TONE: Record<string, string> = {
  confirm: "bg-amber-100 text-amber-800", answer: "bg-sky-100 text-sky-800", notice: "bg-zinc-100 text-zinc-600",
  report: "bg-zinc-100 text-zinc-600", request: "bg-amber-100 text-amber-800", decision: "bg-emerald-100 text-emerald-800",
  directive: "bg-brand-100 text-brand-800", question: "bg-rose-100 text-rose-800", issue: "bg-violet-100 text-violet-800",
};
export const ISSUE_STATUS_TONE: Record<string, string> = {
  new: "bg-sky-100 text-sky-800", in_progress: "bg-amber-100 text-amber-800", resolved: "bg-emerald-100 text-emerald-800",
  feedback: "bg-rose-100 text-rose-800", closed: "bg-zinc-200 text-zinc-600", rejected: "bg-zinc-200 text-zinc-500",
};

export function RunTeamButton({ pid, running }: { pid: string; running: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      {msg && <span className="text-[11px] text-rose-600">{msg}</span>}
      <button className="btn-secondary" disabled={pending || running} onClick={() => start(async () => { const r = await runTeam(pid); setMsg(r.error ?? null); })}>
        <Play size={14} />{running ? "エージェントが動いています…" : pending ? "動かしています…" : "全員を今すぐ確かめる"}
      </button>
    </span>
  );
}
