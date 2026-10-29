"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Compass, Play, Plus, Save, Users } from "lucide-react";
import type { TeamMember, TeamTask } from "@/lib/agent";
import { drawAvatars, editTeamAgent, runTeam, saveTeamTask } from "@/app/(app)/p/[id]/org-actions";
import { Avatar } from "@/components/rail/Avatar";

const HEALTH: Record<string, string> = { green: "bg-emerald-500", yellow: "bg-amber-400", red: "bg-rose-500" };
const TASK: Record<TeamTask["status"], string> = { todo: "未着手", doing: "進行中", blocked: "止まっている", done: "完了" };
const when = (t: string | null) => (t ? new Date(t).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

// エージェントの組織：使命・動く時刻（cron）・止める／動かす。タスクの一覧
function MemberRow({ pid, m, v }: { pid: string; m: TeamMember; v?: string }) {
  const [mission, setMission] = useState(m.mission);
  const [cronExpr, setCron] = useState(m.cron);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ error?: string }>, ok?: string) => start(async () => { const r = await fn(); setMsg(r.error ?? ok ?? null); });
  const Icon = m.role === "director" ? Compass : m.role === "pm" ? Users : null;
  return (
    <div className={`border-b border-zinc-100 px-4 py-2.5 last:border-0 ${m.enabled ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <Avatar k={m.key} v={v} size={36} state={m.state ?? "idle"} />
        {Icon && <Icon size={14} className="text-brand-600" />}
        <span className="font-semibold">{m.name}</span>
        <span className={`h-2 w-2 rounded-full ${m.report ? HEALTH[m.report.health] : "bg-zinc-200"}`} />
        <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-500">{m.report?.summary ?? "まだ動いていません"}</span>
        <span className="text-[11px] text-zinc-500">{m.cron_label}・次 {m.enabled ? when(m.next_run_at) : "止めています"}</span>
        <button className="btn-ghost btn-sm" disabled={pending} onClick={() => act(() => runTeam(pid, [m.key]), "動かしました")} aria-label={`${m.name}を今すぐ動かす`}><Play size={12} /></button>
        <button className="btn-ghost btn-sm" onClick={() => setOpen((x) => !x)} aria-label={`${m.name}の設定`}>設定</button>
      </div>
      {open && (
        <div className="mt-2 space-y-2 pl-1 text-[12px]">
          <label className="block"><span className="label">使命</span>
            <textarea className="input text-[12px]" rows={3} value={mission} aria-label={`${m.name}の使命`} onChange={(e) => setMission(e.target.value)} /></label>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block"><span className="label">動く時刻（cron・日本時間）</span>
              <input className="input h-8 w-44 font-mono text-[12px]" value={cronExpr} aria-label={`${m.name}の cron`} onChange={(e) => setCron(e.target.value)} /></label>
            <label className="mb-1.5 flex items-center gap-1.5"><input type="checkbox" checked={m.enabled} onChange={(e) => act(() => editTeamAgent(pid, m.key, { enabled: e.target.checked }))} />予定で動かす</label>
            <button className="btn-primary btn-sm mb-0.5" disabled={pending} onClick={() => act(() => editTeamAgent(pid, m.key, { mission, cron: cronExpr }), "保存しました")}><Save size={12} />保存</button>
            <Link href={`/p/${pid}/board?agent=${m.key}`} className="mb-1.5 text-[11px] text-brand-700 hover:underline">掲示板で見る</Link>
          </div>
        </div>
      )}
      {msg && <p className="mt-1 text-[11px] text-zinc-500">{msg}</p>}
    </div>
  );
}

export function OrgSettings({ pid, agents, versions }: { pid: string; agents: TeamMember[]; versions: Record<string, string> }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const drawn = Object.keys(versions).length;
  return (
    <section className="card">
      <div className="border-b border-zinc-100 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-[14px] font-semibold">エージェントの組織</h2>
          <span className="ml-auto text-[11px] text-zinc-500">顔 {drawn}/{agents.length}</span>
          <button className="btn-secondary btn-sm" disabled={pending} onClick={() => start(async () => { const r = await drawAvatars(drawn < agents.length ? [] : agents.map((a) => a.key), drawn >= agents.length); setMsg(r.error ?? "顔を描いています（ジョブ）。数分で入れ替わります"); })}>
            {drawn < agents.length ? "顔を描く" : "顔を描き直す"}
          </button>
        </div>
        {msg && <p className="mt-1 text-[11px] text-zinc-500">{msg}</p>}
        <p className="text-[11px] text-zinc-500">司令塔は PdM と戦略を決め、PM に伝える。PM は工程を横ぐしで見て担当に依頼する。各工程の担当は自分の工程を作る。進めていない工程の担当は、依頼がなければ動きません。</p>
      </div>
      {agents.map((m) => <MemberRow key={m.key} pid={pid} m={m} v={versions[m.key]} />)}
    </section>
  );
}

export function TaskBoard({ pid, tasks, agents }: { pid: string; tasks: TeamTask[]; agents: TeamMember[] }) {
  const [title, setTitle] = useState("");
  const [who, setWho] = useState("pm");
  const [pending, start] = useTransition();
  const cols: TeamTask["status"][] = ["todo", "doing", "blocked", "done"];
  return (
    <section className="card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-[14px] font-semibold">タスク</h2>
        <span className="text-[11px] text-zinc-500">エージェントが洗い出し、動くたびに最新にします。PdM が持つタスクには「PdM」と付きます</span>
        <span className="ml-auto flex gap-1.5">
          <select className="input h-8 w-auto py-0 text-[12px]" value={who} onChange={(e) => setWho(e.target.value)} aria-label="タスクの担当">
            {agents.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}
          </select>
          <input className="input h-8 w-56 text-[12px]" value={title} placeholder="タスクを足す" aria-label="タスクを足す" onChange={(e) => setTitle(e.target.value)} />
          <button className="btn-secondary btn-sm" disabled={pending || !title.trim()} onClick={() => start(async () => { await saveTeamTask(pid, null, { agent: who, title }); setTitle(""); })}><Plus size={12} /></button>
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        {cols.map((c) => (
          <div key={c} className="rounded-lg bg-zinc-50 p-2">
            <div className="mb-1.5 text-[11px] font-semibold text-zinc-500">{TASK[c]}（{tasks.filter((t) => t.status === c).length}）</div>
            <div className="space-y-1.5">
              {tasks.filter((t) => t.status === c).slice(0, 40).map((t) => (
                <div key={t.number} className="rounded-md border border-zinc-200 bg-white p-2 text-[12px]">
                  <div className="flex items-center gap-1 text-[10px] text-zinc-500">
                    <span className="font-mono">{t.key}</span><span>{t.agent_name}</span>
                    {t.owner === "pdm" && <span className="rounded bg-rose-100 px-1 text-rose-800">PdM</span>}
                  </div>
                  <div className="mt-0.5">{t.title}</div>
                  <select className="mt-1 w-full rounded border border-zinc-200 bg-white text-[11px]" value={t.status} aria-label={`${t.key}の状態`}
                    onChange={(e) => start(async () => { await saveTeamTask(pid, t.number, { status: e.target.value }); })}>
                    {cols.map((x) => <option key={x} value={x}>{TASK[x]}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
