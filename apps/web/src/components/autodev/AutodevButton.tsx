"use client";
import { useState, useTransition } from "react";
import { Bot, X } from "lucide-react";
import { startAutodev } from "@/app/(app)/p/[id]/autodev-actions";

// ステージの「以降の工程を自動開発する」。案の数と、違いを出す軸（任意）を決めて、ジョブを始める
export function AutodevButton({ pid, sid, targets }: { pid: string; sid: string; targets: string[] }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(3);
  const [hint, setHint] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!targets.length) return null;
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="btn-secondary"><Bot size={14} />以降の工程を自動開発する</button>
      {open && (
        <div role="dialog" aria-label="以降の工程を自動開発する" className="card absolute right-0 top-11 z-30 w-[380px] space-y-3 p-4 shadow-pop">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold">以降の工程を自動開発する</span>
            <button onClick={() => setOpen(false)} className="btn-ghost btn-sm px-1" aria-label="閉じる"><X size={14} /></button>
          </div>
          <p className="text-[12px] leading-5 text-zinc-500">
            ここまでの内容に従って、AI が {targets.join("・")} の下書きと、ブラウザで触れる試作をパターンごとに作ります。
            できたものはプリプロダクトとして残り、比べて1つを採用できます。数分かかります（ジョブ画面で進み具合を見られます）。
          </p>
          <div>
            <label className="label" htmlFor="ad-count">案の数</label>
            <select id="ad-count" value={count} onChange={(e) => setCount(Number(e.target.value))} className="input">
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}案</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="ad-hint">違いを出す軸（任意）</label>
            <input id="ad-hint" value={hint} onChange={(e) => setHint(e.target.value)} className="input" placeholder="例：最小限, 体験重視, 自動化（空なら AI が決める）" />
          </div>
          {err && <p className="text-xs text-rose-600">{err}</p>}
          <button disabled={pending} className="btn-primary w-full"
            onClick={() => start(async () => { const r = await startAutodev(pid, sid, count, hint); if (r?.error) setErr(r.error); })}>
            {pending ? "始めています…" : "自動開発を始める"}
          </button>
        </div>
      )}
    </div>
  );
}
