"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CornerDownRight } from "lucide-react";
import type { BoardThread, TeamMember } from "@/lib/agent";
import { INTENT_LABEL, INTENT_TONE } from "./bits";
import { Avatar } from "@/components/rail/Avatar";

const time = (t: string) => new Date(t).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

// 掲示板の絞り込み（エージェント・目的・言葉）
export function BoardFilter({ pid, agents, agent, intent, q }: { pid: string; agents: TeamMember[]; agent?: string; intent?: string; q?: string }) {
  const router = useRouter();
  const go = (p: Record<string, string | undefined>) => {
    const sp = new URLSearchParams(Object.entries({ agent, intent, q, ...p }).filter(([, v]) => v) as [string, string][]);
    router.push(`/p/${pid}/board${sp.size ? `?${sp}` : ""}`);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className="input h-8 w-auto py-0 text-[12px]" value={agent ?? ""} aria-label="エージェントで絞る" onChange={(e) => go({ agent: e.target.value || undefined })}>
        <option value="">すべてのエージェント</option>
        {agents.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}
      </select>
      <select className="input h-8 w-auto py-0 text-[12px]" value={intent ?? ""} aria-label="目的で絞る" onChange={(e) => go({ intent: e.target.value || undefined })}>
        <option value="">すべての目的</option>
        {["confirm", "answer", "notice"].map((k) => <option key={k} value={k}>{INTENT_LABEL[k]}</option>)}
      </select>
      <form onSubmit={(e) => { e.preventDefault(); go({ q: String(new FormData(e.currentTarget).get("q") ?? "") || undefined }); }}>
        <input name="q" defaultValue={q} className="input h-8 w-56 py-0 text-[12px]" placeholder="言葉で探す" aria-label="言葉で探す" />
      </form>
      {(agent || intent || q) && <Link href={`/p/${pid}/board`} className="text-[12px] text-zinc-500 hover:underline">絞り込みを外す</Link>}
    </div>
  );
}

// エージェント同士のやり取り（PdM は読むだけ。伝えたいことは PM に話す）
export function Threads({ pid, threads, versions = {} }: { pid: string; threads: BoardThread[]; versions?: Record<string, string> }) {
  if (!threads.length) return <div className="card p-8 text-center text-[13px] text-zinc-400">まだやり取りがありません</div>;
  return (
    <div className="space-y-3">
      {threads.map((t) => (
        <article key={t.thread} className="card p-4" aria-label={t.title}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Link href={`/p/${pid}/board?thread=${t.thread}`} className="text-[14px] font-semibold hover:underline">{t.title}</Link>
            <span className="text-[11px] text-zinc-400">#{t.thread}・{t.total ?? t.posts.length}件・{t.participants.length}者</span>
          </div>
          <ol className="space-y-2">
            {t.posts.map((p, i) => (
              <li key={p.id} className={`flex flex-wrap gap-2 text-[12px] ${i ? "pl-4" : ""}`}>
                {i === 1 && (t.omitted ?? 0) > 0 && (
                  <Link href={`/p/${pid}/board?thread=${t.thread}`} className="w-full pb-1 text-[11px] text-brand-700 hover:underline">途中の {t.omitted} 件を省いています（スレッドを開く）</Link>
                )}
                {i > 0 && <CornerDownRight size={12} className="mt-1 shrink-0 text-zinc-300" />}
                {["pdm", "director", "pm"].includes(p.sender)
                  ? <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-300 text-[9px] font-bold text-white">旧</span>
                  : <Avatar k={p.sender} v={versions[p.sender]} size={28} />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className={`rounded px-1 font-medium ${INTENT_TONE[p.intent] ?? INTENT_TONE.notice}`}>{INTENT_LABEL[p.intent] ?? p.intent}</span>
                    <Link href={`/p/${pid}/board?agent=${p.sender}`} className="font-semibold text-zinc-800 hover:underline">{p.sender_name}</Link>
                    <span className="text-zinc-400">→</span>
                    <Link href={`/p/${pid}/board?agent=${p.recipient}`} className="text-zinc-700 hover:underline">{p.recipient_name}</Link>
                    <span className="text-zinc-400">{time(p.created_at)}</span>
                    {!p.read && p.recipient !== "all" && <span className="rounded bg-amber-100 px-1 text-amber-800">未読</span>}
                    {p.job_id && <Link href={`/jobs/${p.job_id}`} className="text-zinc-400 hover:underline">ジョブ</Link>}
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap text-zinc-800">{p.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </article>
      ))}
    </div>
  );
}
