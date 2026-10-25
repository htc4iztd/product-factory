"use client";
import { useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, GitCommitHorizontal, Lock, RotateCcw } from "lucide-react";
import { acknowledge, commit, decide, setStage } from "@/app/(app)/p/[id]/s/[stage]/actions";

function useAction() {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string }>, after?: () => void) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      else after?.();
    });
  };
  return { error, pending, run };
}

export function CommitButton({ pid, sid, missing, dirty, approval, hasVersion }: {
  pid: string; sid: string; missing: string[]; dirty: boolean; approval: boolean; hasVersion: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const { error, pending, run } = useAction();
  const disabled = hasVersion && !dirty;
  return (
    <div className="relative">
      <button disabled={disabled} onClick={() => setOpen((v) => !v)} className="btn-primary" title={disabled ? "最新版から変更がありません" : undefined}>
        <GitCommitHorizontal size={15} />{approval ? "更新して承認に回す" : "更新する"}
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-20 w-80 space-y-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-pop">
          <div className="text-[13px] font-semibold">新しい版として更新</div>
          <p className="text-xs text-zinc-500">
            {approval ? "承認されると最新版になります。" : "すぐに最新版になります。"}
            この版を参照している下流のステージは「要再確認」になります。
          </p>
          {missing.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              <div className="mb-1 flex items-center gap-1 font-medium"><AlertTriangle size={12} />空の必須項目があります</div>
              <ul className="list-disc pl-4">{missing.map((m) => <li key={m}>{m.replace(/^必須の項目「(.+)」が空です$/, "$1")}</li>)}</ul>
            </div>
          )}
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="input" placeholder="変更の要点（任意・監査ログに残ります）" />
          {error && <p className="text-xs text-rose-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="btn-ghost btn-sm">やめる</button>
            <button disabled={pending} onClick={() => run(() => commit(pid, sid, note, missing.length > 0), () => setOpen(false))} className="btn-primary btn-sm">
              {pending ? "更新中…" : missing.length > 0 ? "空欄のまま更新" : "更新"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ApprovalPanel({ pid, sid, version, findings }: { pid: string; sid: string; version: number; findings: string[] }) {
  const [comment, setComment] = useState("");
  const { error, pending, run } = useAction();
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-amber-900"><Lock size={14} />v{version} が承認待ちです</div>
      <p className="mt-1 text-xs text-amber-800">
        {findings.length ? `更新時の検査で ${findings.length} 件の指摘があります：${findings.join("、")}` : "更新時の検査は合格しています。"}
      </p>
      <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} className="input mt-3 bg-white"
        placeholder="理由・修正指示（Request Changes と Accept as-is では必須）" />
      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button disabled={pending} onClick={() => run(() => decide(pid, sid, "Approve", comment))} className="btn-primary btn-sm"><CheckCircle2 size={13} />Approve</button>
        <button disabled={pending} onClick={() => run(() => decide(pid, sid, "Request Changes", comment))} className="btn-secondary btn-sm">Request Changes</button>
        <button disabled={pending} onClick={() => run(() => decide(pid, sid, "Accept as-is", comment))} className="btn-ghost btn-sm">Accept as-is</button>
      </div>
    </div>
  );
}

export function RecheckBanner({ pid, sid, inputs }: { pid: string; sid: string; inputs: string }) {
  const { error, pending, run } = useAction();
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50/60 px-4 py-3 text-[13px] text-rose-900">
      <RotateCcw size={15} />
      <div className="flex-1">
        上流（{inputs}）が更新されました。内容を見直し、直す場合は編集して更新してください。
        {error && <span className="ml-2 text-rose-600">{error}</span>}
      </div>
      <button disabled={pending} onClick={() => run(() => acknowledge(pid, sid))} className="btn-secondary btn-sm">変更不要として確認済みにする</button>
    </div>
  );
}

export function ClosedBanner({ pid, sid }: { pid: string; sid: string }) {
  const { error, pending, run } = useAction();
  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-3 text-[13px] text-zinc-600">
      <div className="flex-1">このステージは閉じています。開くと対話と編集ができます。{error && <span className="ml-2 text-rose-600">{error}</span>}</div>
      <button disabled={pending} onClick={() => run(() => setStage(pid, sid, { enabled: true }))} className="btn-secondary btn-sm">このステージを開く</button>
    </div>
  );
}
