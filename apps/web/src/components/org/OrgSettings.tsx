"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Play, Save, Users } from "lucide-react";
import type { TeamInfo, TeamMember } from "@/lib/agent";
import { drawAvatars, editTeamAgent, runTeam } from "@/app/(app)/p/[id]/org-actions";
import { ScheduleInput } from "./Schedule";
import { Avatar } from "@/components/rail/Avatar";

const HEALTH: Record<string, string> = { green: "bg-emerald-500", yellow: "bg-amber-400", red: "bg-rose-500" };
const when = (t: string | null) => (t ? new Date(t).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

// エージェントの組織：使命・動く時刻（cron）・止める／動かす。タスクの一覧
function MemberRow({ pid, m, v }: { pid: string; m: TeamMember; v?: string }) {
  const [mission, setMission] = useState(m.mission);
  const [cronExpr, setCron] = useState(m.cron);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ error?: string }>, ok?: string) => start(async () => { const r = await fn(); setMsg(r.error ?? ok ?? null); });
  const Icon = m.role === "pm" ? Users : null;
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
            <div className="block"><span className="label">動く予定（日本時間）</span>
              <ScheduleInput value={m.cron} onChange={setCron} label={m.name} /></div>
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
        <p className="text-[11px] text-zinc-500">PdM が話すのは PM だけ。PM は自分の領域の担当に Issue で伝え、1時間ごとに状況を確かめる。各工程の担当は10分ごとに自分宛ての Issue を確かめ、あれば実行して工程に書き込み、結果を返す（なければ AI は使わない）。</p>
      </div>
      {agents.map((m) => <MemberRow key={m.key} pid={pid} m={m} v={versions[m.key]} />)}
    </section>
  );
}

// 会議の予定と、定期実行が動いているか
