"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Play, Send } from "lucide-react";
import type { BoardPostT, DirectorView } from "@/lib/agent";
import { Avatar } from "@/components/rail/Avatar";
import { runTeam, talkDirector } from "@/app/(app)/p/[id]/org-actions";

const time = (t: string) => new Date(t).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
export const INTENT_LABEL: Record<string, string> = { report: "報告", request: "依頼", answer: "回答", decision: "決定", directive: "指示", question: "質問" };
export const INTENT_TONE: Record<string, string> = {
  report: "bg-zinc-100 text-zinc-600", request: "bg-amber-100 text-amber-800", answer: "bg-sky-100 text-sky-800",
  decision: "bg-emerald-100 text-emerald-800", directive: "bg-brand-100 text-brand-800", question: "bg-rose-100 text-rose-800",
};

// 司令塔との対話：PdM はいつでも話しかけられる。司令塔は毎日、議題を用意して待つ。決めたら PM に伝わる
export function DirectorChat({ pid, v, versions = {} }: { pid: string; v: DirectorView; versions?: Record<string, string> }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const send = () => start(async () => {
    const r = await talkDirector(pid, text, v.thread);
    if (r.error) setError(r.error); else { setText(""); setError(null); }
  });
  return (
    <section className="card flex flex-col" aria-label="司令塔との対話">
      <div className="flex items-center gap-1.5 border-b border-zinc-100 px-4 py-2.5">
        <Avatar k="director" v={versions.director} size={30} /><h2 className="text-[14px] font-semibold">司令塔と話す</h2>
        <span className="text-[11px] text-zinc-400">いつでも話しかけられます。決めたことは PM から各担当に伝わります</span>
      </div>
      {v.strategy?.strategy && (
        <div className="mx-4 mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-[12px]">
          <div className="text-[11px] font-semibold text-emerald-800">いまの戦略{v.strategy.decided_at && `（${time(v.strategy.decided_at)} 決定）`}</div>
          <div className="mt-0.5 text-zinc-800">{v.strategy.strategy}</div>
          {!!v.strategy.priorities?.length && <ol className="mt-1 list-decimal pl-4 text-zinc-700">{v.strategy.priorities.map((p, i) => <li key={i}>{p}</li>)}</ol>}
        </div>
      )}
      <ol className="max-h-[360px] flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {v.posts.length === 0 && <li className="text-[12px] text-zinc-400">今日はまだ話していません。司令塔は毎朝、今日決めたいことを用意します。</li>}
        {v.posts.map((p) => <Bubble key={p.id} p={p} v={versions[p.sender]} />)}
      </ol>
      <div className="space-y-1.5 border-t border-zinc-100 p-3">
        <textarea className="input text-[13px]" rows={2} value={text} aria-label="司令塔への発言" placeholder="例：最初は共働き世帯に絞る。MVP は締め処理だけで決定"
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) send(); }} />
        {error && <p className="text-[12px] text-rose-600">{error}</p>}
        <div className="flex items-center gap-2">
          <button className="btn-primary btn-sm" disabled={pending || !text.trim()} onClick={send}><Send size={12} />{pending ? "司令塔が考えています…" : "話す"}</button>
          {v.thread && <Link href={`/p/${pid}/board?thread=${v.thread}`} className="text-[11px] text-zinc-500 hover:underline">掲示板で見る</Link>}
        </div>
      </div>
    </section>
  );
}

function Bubble({ p, v }: { p: BoardPostT; v?: string }) {
  const me = p.sender === "pdm";
  return (
    <li className={`flex items-end gap-2 ${me ? "justify-end" : ""}`}>
      {!me && <Avatar k={p.sender} v={v} size={26} />}
      <div className={`max-w-[85%] rounded-xl px-3 py-2 text-[12px] ${me ? "bg-zinc-900 text-white" : p.intent === "decision" ? "border border-emerald-200 bg-emerald-50" : "bg-zinc-100 text-zinc-800"}`}>
        <div className={`mb-0.5 text-[10px] ${me ? "text-zinc-400" : "text-zinc-500"}`}>{p.sender_name} → {p.recipient_name}・{INTENT_LABEL[p.intent]}・{time(p.created_at)}</div>
        <div className="whitespace-pre-wrap">{p.text}</div>
      </div>
    </li>
  );
}

// PdM 宛て：エージェントからの質問・報告。工程の担当からのものは工程の画面で答えられる
export function PdmInbox({ pid, posts: all, findings }: { pid: string; posts: BoardPostT[]; findings: number }) {
  // まだ答えていないもの（未読）だけを並べる。答えたものは掲示板で追える
  const posts = all.filter((p) => !p.read);
  return (
    <section className="card" aria-label="PdM 宛て">
      <div className="flex items-center gap-1.5 border-b border-zinc-100 px-4 py-2.5">
        <h2 className="text-[14px] font-semibold">PdM 宛て</h2>
        {findings > 0 && <Link href={`/p/${pid}/agents`} className="ml-auto text-[11px] text-brand-700 hover:underline">定期の仕事からの提案 {findings} 件</Link>}
      </div>
      <ol className="max-h-[340px] divide-y divide-zinc-100 overflow-y-auto">
        {posts.length === 0 && <li className="px-4 py-3 text-[12px] text-zinc-400">答えていないものはありません</li>}
        {posts.map((p) => (
          <li key={p.id} className="px-4 py-2.5 text-[12px]">
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className={`rounded px-1 font-medium ${INTENT_TONE[p.intent]}`}>{INTENT_LABEL[p.intent]}</span>
              <span className="font-medium text-zinc-700">{p.sender_name}</span>
              <span className="text-zinc-400">{time(p.created_at)}</span>
              <Link href={/^s\d\d$/.test(p.sender) ? `/p/${pid}/s/${p.sender}` : `/p/${pid}/board?thread=${p.thread}`} className="ml-auto text-brand-700 hover:underline">
                {/^s\d\d$/.test(p.sender) ? "工程で答える" : "掲示板で答える"}
              </Link>
            </div>
            <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-zinc-700">{p.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function RunTeamButton({ pid, running }: { pid: string; running: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      {msg && <span className="text-[11px] text-rose-600">{msg}</span>}
      <button className="btn-primary" disabled={pending || running} onClick={() => start(async () => { const r = await runTeam(pid); setMsg(r.error ?? null); })}>
        <Play size={14} />{running ? "エージェントが動いています…" : pending ? "動かしています…" : "全員を今すぐ動かす"}
      </button>
    </span>
  );
}
