"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Bot, Check, CheckCheck, MessageSquare, Pencil, Play, Power, Send, Trash2, User, X } from "lucide-react";
import type { AgentFinding, AgentSchedule, FieldValue, StageSummary } from "@/lib/agent";
import { decideFinding, deleteAgent, replyFinding, runAgent, saveAgent } from "@/app/(app)/p/[id]/agents/actions";
import { AgentForm } from "./AgentForm";

const SEV: Record<AgentFinding["severity"], { label: string; cls: string }> = {
  action: { label: "直すべき", cls: "bg-rose-100 text-rose-800" }, warn: { label: "確認すべき", cls: "bg-amber-100 text-amber-800" },
  info: { label: "参考", cls: "bg-zinc-100 text-zinc-600" },
};
const DONE: Record<string, string> = { accepted: "採用した", rejected: "却下した", noted: "確認済み" };
const when = (t: string | null) => (t ? new Date(t).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

// 案の値をざっと見せる（文章・箇条・表・図）
function Preview({ v }: { v: FieldValue }) {
  if (typeof v === "string") return <div className="line-clamp-6 whitespace-pre-wrap">{v}</div>;
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === "string")) return <ul className="list-disc pl-4">{(v as string[]).slice(0, 8).map((x, i) => <li key={i}>{x}</li>)}</ul>;
    const rows = v as Record<string, unknown>[];
    const keys = Object.keys(rows[0] ?? {}).filter((k) => typeof rows[0][k] !== "object").slice(0, 5);
    return (
      <table className="w-full border-collapse text-[11px]"><tbody>
        {rows.slice(0, 6).map((r, i) => <tr key={i} className="border-t border-zinc-100">{keys.map((k) => <td key={k} className="px-1 py-0.5">{String(r[k] ?? "")}</td>)}</tr>)}
        {rows.length > 6 && <tr><td className="px-1 text-zinc-400">ほか {rows.length - 6} 行</td></tr>}
      </tbody></table>
    );
  }
  return <code className="text-[11px] text-zinc-500">{JSON.stringify(v).slice(0, 200)}</code>;
}

function FindingCard({ pid, f }: { pid: string; f: AgentFinding }) {
  const [picks, setPicks] = useState<number[]>(f.proposals.map((_, i) => i));
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ error?: string }>) => start(async () => { const r = await fn(); setError(r.error ?? null); });
  const open = f.status === "open";
  return (
    <article className={`card space-y-2 p-4 ${open ? "" : "opacity-70"}`} aria-label={f.title}>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className={`rounded px-1.5 py-0.5 font-medium ${SEV[f.severity].cls}`}>{SEV[f.severity].label}</span>
        {f.stage_label && <Link href={`/p/${pid}/s/${f.stage}`} className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-600 hover:underline">{f.stage_label}</Link>}
        {f.agent && <span className="text-zinc-500">{f.agent}</span>}
        <span className="text-zinc-400">{when(f.created_at)}</span>
        {!open && <span className="ml-auto text-zinc-500">{DONE[f.status]}（{f.decided_by}）</span>}
      </div>
      <h3 className="text-[14px] font-semibold">{f.title}</h3>
      {f.body && <p className="whitespace-pre-wrap text-[13px] text-zinc-700">{f.body}</p>}
      {f.proposals.length > 0 && (
        <div className="space-y-1.5">
          {f.proposals.map((p, i) => (
            <label key={i} className="flex gap-2 rounded-lg border border-brand-200 bg-brand-50/40 p-2 text-[12px]">
              {open && <input type="checkbox" className="mt-0.5" checked={picks.includes(i)} aria-label={`案「${p.label}」を入れる`}
                onChange={(e) => setPicks((x) => (e.target.checked ? [...x, i] : x.filter((y) => y !== i)))} />}
              <span className="min-w-0 flex-1">
                <span className="font-medium">「{p.label}」をこう直す</span>
                <span className="mt-1 block text-zinc-700"><Preview v={p.value} /></span>
                {p.reason && <span className="mt-1 block text-[11px] text-zinc-500">理由：{p.reason}</span>}
              </span>
            </label>
          ))}
        </div>
      )}
      {f.thread.length > 0 && (
        <ol className="space-y-1.5 border-l-2 border-zinc-100 pl-3">
          {f.thread.map((m, i) => (
            <li key={i} className="flex gap-1.5 text-[12px]">
              {m.role === "agent" ? <Bot size={13} className="mt-0.5 shrink-0 text-brand-600" /> : <User size={13} className="mt-0.5 shrink-0 text-zinc-400" />}
              <span className="whitespace-pre-wrap text-zinc-700">{m.text}</span>
            </li>
          ))}
        </ol>
      )}
      {open && (<>
        <div className="flex flex-wrap items-center gap-1.5">
          {f.proposals.length > 0 && (
            <button className="btn-primary btn-sm" disabled={pending || !picks.length} onClick={() => act(() => decideFinding(pid, f.id, "accept", picks))}>
              <Check size={12} />採用して入れる
            </button>
          )}
          <button className="btn-secondary btn-sm" disabled={pending} onClick={() => act(() => decideFinding(pid, f.id, "note"))}><CheckCheck size={12} />確認済み</button>
          <button className="btn-ghost btn-sm" disabled={pending} onClick={() => act(() => decideFinding(pid, f.id, "reject", undefined, text))}><X size={12} />却下</button>
        </div>
        <div className="flex gap-1.5">
          <input className="input h-8 text-[12px]" value={text} placeholder="AI に返信する（根拠を聞く・条件を足す・案を直させる）" aria-label="AI への返信"
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) act(async () => { const r = await replyFinding(pid, f.id, text); if (!r.error) setText(""); return r; }); }} />
          <button className="btn-secondary btn-sm" disabled={pending || !text.trim()} aria-label="返信を送る"
            onClick={() => act(async () => { const r = await replyFinding(pid, f.id, text); if (!r.error) setText(""); return r; })}>
            {pending ? "…" : <Send size={12} />}
          </button>
        </div>
      </>)}
      {error && <p className="text-[12px] text-rose-600">{error}</p>}
    </article>
  );
}

export function Inbox({ pid, findings }: { pid: string; findings: AgentFinding[] }) {
  const [tab, setTab] = useState<"open" | "done">("open");
  const shown = findings.filter((f) => (tab === "open" ? f.status === "open" : f.status !== "open"));
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-1.5" role="tablist" aria-label="受け箱">
        <MessageSquare size={15} className="text-brand-600" /><h2 className="mr-2 text-[14px] font-semibold">提案の受け箱</h2>
        {(["open", "done"] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-md px-2.5 py-1 text-[12px] font-medium ${tab === k ? "bg-zinc-900 text-white" : "border border-zinc-200 bg-white text-zinc-600"}`}>
            {k === "open" ? `未対応 ${findings.filter((f) => f.status === "open").length}` : "対応済み"}
          </button>
        ))}
      </div>
      {shown.length === 0 && <div className="card p-6 text-center text-[13px] text-zinc-400">{tab === "open" ? "未対応の提案はありません" : "まだありません"}</div>}
      {shown.map((f) => <FindingCard key={f.id} pid={pid} f={f} />)}
    </section>
  );
}

export function ScheduleList({ pid, schedules, stages, libraries, reports }: {
  pid: string; schedules: AgentSchedule[]; stages: StageSummary[]; libraries: { number: number; name: string }[]; reports: { number: number; title: string }[];
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const act = (fn: () => Promise<{ error?: string }>) => start(async () => { const r = await fn(); setError(r.error ?? null); });
  const names = Object.fromEntries(stages.map((s) => [s.id, `${s.no}${s.name}`]));
  return (
    <div className="space-y-2">
      {error && <p className="text-[12px] text-rose-600">{error}</p>}
      {schedules.map((a) => (
        <div key={a.number} className={`card p-3 ${a.enabled ? "" : "opacity-60"}`}>
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <Bot size={15} className={a.enabled ? "text-brand-600" : "text-zinc-400"} />
            <span className="font-mono text-[11px] text-zinc-500">{a.key}</span>
            <span className="font-semibold">{a.name}</span>
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600">{a.task_label}</span>
            <span className="text-[12px] text-zinc-600">{a.cron_label}</span>
            <span className="ml-auto flex gap-1">
              <button className="btn-secondary btn-sm" disabled={pending} onClick={() => act(() => runAgent(pid, a.number))} aria-label={`${a.key}を今すぐ動かす`}><Play size={12} />今すぐ</button>
              <button className="btn-ghost btn-sm" disabled={pending} onClick={() => act(() => saveAgent(pid, a.number, { enabled: !a.enabled }))} aria-label={a.enabled ? "止める" : "再開する"}><Power size={12} />{a.enabled ? "止める" : "再開"}</button>
              <button className="btn-ghost btn-sm" onClick={() => setEditing(editing === a.number ? null : a.number)} aria-label="予定を直す"><Pencil size={12} /></button>
              <button className="btn-ghost btn-sm text-zinc-400 hover:text-rose-600" disabled={pending} onClick={() => { if (confirm(`${a.key} を削除しますか？`)) act(() => deleteAgent(pid, a.number)); }} aria-label="予定を削除"><Trash2 size={12} /></button>
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 pl-6 text-[11px] text-zinc-500">
            <span>次：{a.enabled ? when(a.next_run_at) : "止めています"}</span>
            <span>前回：{when(a.last_run_at)}{a.last_job_id && <> （<Link href={`/jobs/${a.last_job_id}`} className="text-brand-700 hover:underline">ジョブ</Link>）</>}</span>
            <span>{a.runs}回</span>
            {a.stages.length > 0 && <span>工程：{a.stages.map((s) => names[s] ?? s).join("・")}</span>}
            {a.instruction && <span className="truncate">指示：{a.instruction}</span>}
          </div>
          {editing === a.number && (
            <div className="mt-3 border-t border-zinc-100 pt-3">
              <AgentForm pid={pid} stages={stages} libraries={libraries} reports={reports} a={a} onDone={() => setEditing(null)} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
