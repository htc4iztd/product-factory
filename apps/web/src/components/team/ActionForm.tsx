"use client";
import { useActionState, useEffect, useRef } from "react";

type Result = { error?: string } | undefined;

// サーバーアクションを呼ぶフォーム。失敗は下に出し、成功したら入力を空にする
export function ActionForm({ action, children, submit, className = "space-y-3", reset = true, pendingLabel = "送信中…" }: {
  action: (prev: Result, f: FormData) => Promise<Result>; children: React.ReactNode; submit: React.ReactNode;
  className?: string; reset?: boolean; pendingLabel?: string;
}) {
  const [state, run, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  const was = useRef(false);
  useEffect(() => {
    if (was.current && !pending && !state?.error && reset) ref.current?.reset();
    was.current = pending;
  }, [pending, state, reset]);
  return (
    <form ref={ref} action={run} className={className}>
      {children}
      <div className="flex items-center gap-2">
        <button disabled={pending} className="btn-primary btn-sm">{pending ? pendingLabel : submit}</button>
        {state?.error && <span className="text-xs text-rose-600">{state.error}</span>}
      </div>
    </form>
  );
}
