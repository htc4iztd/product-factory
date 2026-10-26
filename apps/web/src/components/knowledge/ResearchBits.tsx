"use client";
import { createContext, useContext, useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { startUpdate } from "@/app/(app)/research/actions";

// いま動いている更新ジョブ（なければ null）。タブごとの更新ボタンが、動いている間は押せないようにする
export type Running = { id: string; scope: string } | null;
export const RunningCtx = createContext<Running>(null);

const SCOPE: Record<string, string> = {
  all: "すべて", articles: "記事とファクト", issues: "論点", players: "プレーヤー", tech: "技術調査", industry: "業界調査", public: "公的データ",
};

// 更新ボタン。scope=all は記事を集めてから、論点・プレーヤー・調査レポートまで一度に作り直す
// running を渡さなければ、ResearchApp が配る RunningCtx を使う（ページの見出しのようにその外で使うときは渡す）
export function UpdateButton({ n, scope = "all", label, primary = false, title, running: given }: {
  n: number; scope?: string; label: string; primary?: boolean; title?: string; running?: Running;
}) {
  const ctx = useContext(RunningCtx);
  const running = given === undefined ? ctx : given;
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const mine = running && (running.scope === scope || running.scope === "all");
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button disabled={!!running || pending} title={title} className={`${primary ? "btn-primary" : "btn-secondary"} btn-sm`}
        onClick={() => start(async () => { const r = await startUpdate(n, scope); setError(r.error ?? null); })}>
        <RefreshCw size={13} className={mine || pending ? "animate-spin" : ""} />{mine ? "更新中…" : label}
      </button>
      {running && !mine && <a href={`/jobs/${running.id}`} className="text-[11px] text-zinc-500 hover:underline">「{SCOPE[running.scope] ?? running.scope}」を更新中</a>}
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </span>
  );
}
