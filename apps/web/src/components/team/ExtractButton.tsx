"use client";
import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { extractThread } from "@/app/(app)/p/[id]/team-actions";

export function ExtractButton({ pid, postId }: { pid: string; postId: number }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      {msg && <span className="text-[11px] text-zinc-500">{msg}</span>}
      <button type="button" disabled={pending} className="btn-secondary btn-sm"
        onClick={() => start(async () => {
          const r = await extractThread(pid, postId);
          setMsg(r.error ?? `決定 ${r.decisions}件・宿題 ${r.tickets}件`);
        })}>
        <Sparkles size={12} />{pending ? "読んでいます…" : "決定と宿題を抜き出す"}
      </button>
    </span>
  );
}
