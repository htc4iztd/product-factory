"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CornerDownRight, Send } from "lucide-react";
import type { BoardThread, TeamMember } from "@/lib/agent";
import { postBoard } from "@/app/(app)/p/[id]/org-actions";
import { INTENT_LABEL, INTENT_TONE } from "./DirectorChat";
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
        <option value="pdm">PdM</option>
        {agents.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}
      </select>
      <select className="input h-8 w-auto py-0 text-[12px]" value={intent ?? ""} aria-label="目的で絞る" onChange={(e) => go({ intent: e.target.value || undefined })}>
        <option value="">すべての目的</option>
        {Object.entries(INTENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <form onSubmit={(e) => { e.preventDefault(); go({ q: String(new FormData(e.currentTarget).get("q") ?? "") || undefined }); }}>
        <input name="q" defaultValue={q} className="input h-8 w-56 py-0 text-[12px]" placeholder="言葉で探す" aria-label="言葉で探す" />
      </form>
      {(agent || intent || q) && <Link href={`/p/${pid}/board`} className="text-[12px] text-zinc-500 hover:underline">絞り込みを外す</Link>}
    </div>
  );
}

// PdM が書く：新しい話題、またはスレッドへの返信・追加の指示。宛先はすぐ動く（司令塔はその場で答える）
export function Composer({ pid, agents, thread, defaultTo }: { pid: string; agents: TeamMember[]; thread?: number; defaultTo?: string }) {
  const [to, setTo] = useState(defaultTo ?? "director");
  const [intent, setIntent] = useState("directive");
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const send = () => start(async () => {
    const r = await postBoard(pid, to, text, thread ?? null, intent);
    if (r.error) setMsg(r.error); else { setText(""); setMsg(to === "director" ? null : "送りました。宛先のエージェントが動いて答えます"); }
  });
  return (
    <div className={`space-y-1.5 ${thread ? "" : "card p-4"}`}>
      {!thread && <div className="text-[13px] font-semibold">新しく書く（PdM から）</div>}
      <div className="flex flex-wrap gap-1.5">
        <select className="input h-8 w-auto py-0 text-[12px]" value={to} aria-label="宛先" onChange={(e) => setTo(e.target.value)}>
          {agents.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}
          <option value="all">全員</option>
        </select>
        <select className="input h-8 w-auto py-0 text-[12px]" value={intent} aria-label="目的" onChange={(e) => setIntent(e.target.value)}>
          <option value="directive">指示</option><option value="question">質問</option><option value="answer">回答</option><option value="report">共有</option>
        </select>
        <input className="input h-8 min-w-[16rem] flex-1 text-[12px]" value={text} aria-label={thread ? "このスレッドに書く" : "本文"}
          placeholder={thread ? "このスレッドに返信・追加の指示" : "例：⑨の担当へ。決済まわりは外部サービスを使う前提で設計し直して"}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) send(); }} />
        <button className="btn-primary btn-sm" disabled={pending || !text.trim()} onClick={send} aria-label="書き込む"><Send size={12} />{pending ? "…" : ""}</button>
      </div>
      {msg && <p className="text-[11px] text-zinc-500">{msg}</p>}
    </div>
  );
}

export function Threads({ pid, threads, agents, versions = {} }: { pid: string; threads: BoardThread[]; agents: TeamMember[]; versions?: Record<string, string> }) {
  if (!threads.length) return <div className="card p-8 text-center text-[13px] text-zinc-400">まだ書き込みがありません</div>;
  return (
    <div className="space-y-3">
      {threads.map((t) => {
        const last = t.posts[t.posts.length - 1];
        const reply = last.sender === "pdm" ? last.recipient : last.sender;
        return (
          <article key={t.thread} className="card p-4" aria-label={t.title}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Link href={`/p/${pid}/board?thread=${t.thread}`} className="text-[14px] font-semibold hover:underline">{t.title}</Link>
              <span className="text-[11px] text-zinc-400">#{t.thread}・{t.posts.length}件・{t.participants.length}者</span>
            </div>
            <ol className="space-y-2">
              {t.posts.map((p, i) => (
                <li key={p.id} className={`flex gap-2 text-[12px] ${i ? "pl-4" : ""}`}>
                  {i > 0 && <CornerDownRight size={12} className="mt-1 shrink-0 text-zinc-300" />}
                  {p.sender === "pdm"
                    ? <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-bold text-white">PdM</span>
                    : <Avatar k={p.sender} v={versions[p.sender]} size={28} />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className={`rounded px-1 font-medium ${INTENT_TONE[p.intent]}`}>{INTENT_LABEL[p.intent]}</span>
                      <Link href={`/p/${pid}/board?agent=${p.sender}`} className="font-semibold text-zinc-800 hover:underline">{p.sender_name}</Link>
                      <span className="text-zinc-400">→</span>
                      <Link href={`/p/${pid}/board?agent=${p.recipient}`} className="text-zinc-700 hover:underline">{p.recipient_name}</Link>
                      <span className="text-zinc-400">{time(p.created_at)}</span>
                      {!p.read && !["pdm", "all"].includes(p.recipient) && <span className="rounded bg-amber-100 px-1 text-amber-800">未読</span>}
                      {p.job_id && <Link href={`/jobs/${p.job_id}`} className="text-zinc-400 hover:underline">ジョブ</Link>}
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap text-zinc-800">{p.text}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-3 border-t border-zinc-100 pt-2">
              <Composer pid={pid} agents={agents} thread={t.thread} defaultTo={reply === "all" ? "pm" : reply} />
            </div>
          </article>
        );
      })}
    </div>
  );
}
