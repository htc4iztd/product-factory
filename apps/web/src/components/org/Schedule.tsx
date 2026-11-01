"use client";
import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { CalendarClock, Pause, Play, Save } from "lucide-react";
import { DAYS, EVERY_HOURS, EVERY_MIN, MODES, defaultFor, fromCron, toCron, type Sched } from "@/lib/schedule";
import { previewSchedule, saveSchedule, setPlatformEvery } from "@/app/(app)/p/[id]/org-actions";
import { Avatar } from "@/components/rail/Avatar";

const when = (t: string) => new Date(t).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" });
const hourJst = (t: string, i: number) => new Date(new Date(t).getTime() + i * 3600_000).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour: "numeric", hour12: false });

// 予定を選ぶ（cron を書かない）。選ぶたびに読み方と次の3回を確かめる
export function ScheduleInput({ value, onChange, label = "予定" }: { value: string; onChange: (cron: string) => void; label?: string }) {
  const [s, setS] = useState<Sched>(() => fromCron(value));
  const [pv, setPv] = useState<{ error?: string; label?: string; next?: string[]; warning?: string } | null>(null);
  const cron = toCron(s);
  useEffect(() => { setS(fromCron(value)); }, [value]);
  useEffect(() => {
    const t = setTimeout(async () => { setPv(await previewSchedule(cron)); }, 250);
    return () => clearTimeout(t);
  }, [cron]);
  const set = (x: Sched) => { setS(x); onChange(toCron(x)); };
  const time = (v: string, f: (t: string) => Sched) => <input type="time" className="input h-8 w-28 text-[12.5px]" value={v} aria-label={`${label}の時刻`} onChange={(e) => set(f(e.target.value))} />;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <select className="input h-8 w-auto text-[12.5px]" value={s.mode} aria-label={`${label}の決め方`} onChange={(e) => set(defaultFor(e.target.value as Sched["mode"], s))}>
          {MODES.map(([m, l]) => <option key={m} value={m}>{l}</option>)}
        </select>
        {s.mode === "every" && (
          <select className="input h-8 w-auto text-[12.5px]" value={s.minutes} aria-label={`${label}の間隔（分）`} onChange={(e) => set({ ...s, minutes: +e.target.value })}>
            {EVERY_MIN.map((m) => <option key={m} value={m}>{m}分ごと</option>)}
          </select>
        )}
        {s.mode === "hourly" && (
          <>
            <select className="input h-8 w-auto text-[12.5px]" value={s.hours} aria-label={`${label}の間隔（時間）`} onChange={(e) => set({ ...s, hours: +e.target.value })}>
              {EVERY_HOURS.map((h) => <option key={h} value={h}>{h === 1 ? "毎時" : `${h}時間ごと`}</option>)}
            </select>
            <select className="input h-8 w-auto text-[12.5px]" value={s.minute} aria-label={`${label}の分`} onChange={(e) => set({ ...s, minute: +e.target.value })}>
              {[0, 5, 10, 15, 20, 30, 45].map((m) => <option key={m} value={m}>{m}分</option>)}
            </select>
          </>
        )}
        {(s.mode === "daily" || s.mode === "weekdays") && time(s.time, (t) => ({ ...s, time: t }))}
        {s.mode === "weekly" && (
          <>
            {DAYS.map((d, i) => (
              <button key={d} type="button" aria-pressed={s.days.includes(i)} onClick={() => set({ ...s, days: s.days.includes(i) ? s.days.filter((x) => x !== i) : [...s.days, i] })}
                className={`h-8 w-8 rounded-full border text-[12px] ${s.days.includes(i) ? "border-brand-400 bg-brand-50 font-medium text-brand-800" : "border-zinc-200 text-zinc-600"}`}>{d}</button>
            ))}
            {time(s.time, (t) => ({ ...s, time: t }))}
          </>
        )}
        {s.mode === "custom" && (
          <input className="input h-8 w-44 font-mono text-[12px]" value={s.cron} aria-label={`${label}の cron`} placeholder="分 時 日 月 曜日"
            onChange={(e) => set({ mode: "custom", cron: e.target.value })} />
        )}
      </div>
      <div className="text-[11px]" aria-live="polite">
        {pv?.error ? <span className="text-rose-600">{pv.error}</span> : pv?.label ? (
          <span className="text-zinc-500"><span className="font-medium text-zinc-700">{pv.label}</span>・次：{(pv.next ?? []).map(when).join("／")}
            {pv.warning && <span className="ml-1 text-amber-700">（{pv.warning}）</span>}</span>
        ) : null}
      </div>
    </div>
  );
}

export type SchedAgent = {
  key: string; name: string; group: string; group_label: string; what: string; cron: string; label: string; enabled: boolean;
  next: string[]; last_run_at: string | null; hours: number[];
};
export type ScheduleView = {
  start: string; hours: number; groups: { key: string; label: string }[]; agents: SchedAgent[];
  platform: { every_min: number; label: string; last_at: string | null; choices: number[]; what: string };
};
export type OverviewRow = { id: string; name: string; set_up: boolean; groups: { key: string; label: string; schedules: string[]; stopped: number; total: number; next_run_at: string | null }[] };

// プロダクトの予定：時間割（これから24時間）と、選んだエージェントの予定をまとめて変える
export function ScheduleBoard({ pid, v, versions }: { pid: string; v: ScheduleView; versions: Record<string, string> }) {
  const [sel, setSel] = useState<string[]>([]);
  const [cron, setCron] = useState(v.agents.find((a) => a.key === "s01")?.cron ?? "*/10 * * * *");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const max = useMemo(() => Math.max(1, ...v.agents.flatMap((a) => a.hours)), [v.agents]);
  const toggle = (keys: string[]) => setSel((x) => (keys.every((k) => x.includes(k)) ? x.filter((k) => !keys.includes(k)) : [...new Set([...x, ...keys])]));
  const act = (body: { cron?: string; enabled?: boolean }, ok: string) => start(async () => {
    const r = await saveSchedule(pid, sel, body);
    setMsg(r.error ?? ok);
  });
  return (
    <div className="space-y-4">
      <section className="card p-4" aria-label="予定を変える">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold">選んだエージェントの予定を変える <span className="font-normal text-zinc-500">（{sel.length} 人を選択中。下の表の左の欄で選びます）</span></div>
            <div className="mt-2"><ScheduleInput value={cron} onChange={setCron} label="選んだエージェントの予定" /></div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button className="btn-primary btn-sm" disabled={pending || !sel.length} onClick={() => act({ cron }, `${sel.length} 人の予定を変えました`)}><Save size={12} />この予定にする</button>
              <button className="btn-secondary btn-sm" disabled={pending || !sel.length} onClick={() => act({ enabled: false }, `${sel.length} 人を止めました`)}><Pause size={12} />止める</button>
              <button className="btn-secondary btn-sm" disabled={pending || !sel.length} onClick={() => act({ enabled: true }, `${sel.length} 人を動かします`)}><Play size={12} />動かす</button>
              {msg && <span className="text-[12px] text-zinc-600" role="status">{msg}</span>}
            </div>
          </div>
          <PlatformEvery pid={pid} p={v.platform} />
        </div>
      </section>
      <section className="card overflow-x-auto" aria-label="時間割">
        <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2.5">
          <CalendarClock size={15} className="text-brand-600" />
          <h2 className="text-[14px] font-semibold">これから24時間の時間割</h2>
          <span className="text-[11px] text-zinc-500">マスの数字はその1時間に動く回数。Issue が来たときは予定を待たずにすぐ動きます</span>
        </div>
        <table className="text-[11.5px]">
          <thead>
            <tr className="text-zinc-500">
              <th className="sticky left-0 z-10 bg-white px-3 py-1.5 text-left font-medium">エージェント</th>
              <th className="px-2 text-left font-medium">予定</th>
              {Array.from({ length: v.hours }, (_, i) => <th key={i} className="w-7 text-center font-normal">{hourJst(v.start, i)}</th>)}
            </tr>
          </thead>
          <tbody>
            {v.groups.map((g) => {
              const rows = v.agents.filter((a) => a.group === g.key);
              const keys = rows.map((a) => a.key);
              return [
                <tr key={g.key} className="bg-zinc-50">
                  <td colSpan={2 + v.hours} className="sticky left-0 px-3 py-1">
                    <label className="flex items-center gap-1.5 text-[11.5px] font-semibold text-zinc-600">
                      <input type="checkbox" checked={keys.every((k) => sel.includes(k))} onChange={() => toggle(keys)} aria-label={`${g.label}をまとめて選ぶ`} />{g.label}
                    </label>
                  </td>
                </tr>,
                ...rows.map((a) => (
                  <tr key={a.key} className={`border-t border-zinc-100 ${a.enabled ? "" : "opacity-50"}`} data-key={a.key}>
                    <td className="sticky left-0 z-10 bg-white px-3 py-1">
                      <label className="flex items-center gap-1.5 whitespace-nowrap" title={a.what}>
                        <input type="checkbox" checked={sel.includes(a.key)} onChange={() => toggle([a.key])} aria-label={`${a.name}を選ぶ`} />
                        {a.key !== "meeting" && <Avatar k={a.key} v={versions[a.key]} size={20} />}
                        <span>{a.name}</span>
                      </label>
                    </td>
                    <td className="whitespace-nowrap px-2 text-zinc-600" title={a.next.length ? `次：${a.next.map(when).join("／")}` : ""}>
                      {a.enabled ? a.label : "止めています"}
                    </td>
                    {a.hours.map((n, i) => (
                      <td key={i} className="p-0.5 text-center">
                        {n > 0 && <span className="block rounded text-[10px] font-medium text-white" style={{ background: `color-mix(in srgb, var(--color-brand, #6366f1) ${30 + Math.round((n / max) * 70)}%, white)` }}>{n}</span>}
                      </td>
                    ))}
                  </tr>
                )),
              ];
            })}
            <tr className="border-t border-zinc-200 bg-zinc-50">
              <td className="sticky left-0 z-10 bg-zinc-50 px-3 py-1 font-medium">プラットフォームの見回り</td>
              <td className="px-2 text-zinc-600">{v.platform.label}</td>
              {Array.from({ length: v.hours }, (_, i) => <td key={i} className="p-0.5 text-center"><span className="block rounded bg-zinc-300 text-[10px] text-white">{Math.floor(60 / v.platform.every_min)}</span></td>)}
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}

function PlatformEvery({ pid, p }: { pid: string; p: ScheduleView["platform"] }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="w-72 rounded-lg border border-zinc-200 p-3">
      <div className="flex items-center gap-2 text-[12.5px] font-semibold"><Avatar k="platform" size={20} />プラットフォームの見回り</div>
      <p className="mt-0.5 text-[11px] text-zinc-500">{p.what}。テナントのすべてのプロダクトが対象です</p>
      <select className="input mt-1.5 h-8 text-[12.5px]" value={p.every_min} disabled={pending} aria-label="プラットフォームの見回りの間隔"
        onChange={(e) => start(async () => { const r = await setPlatformEvery(pid, +e.target.value); setMsg(r.error ?? "変えました"); })}>
        {p.choices.map((m) => <option key={m} value={m}>{m}分ごと</option>)}
      </select>
      <p className="mt-1 text-[11px] text-zinc-500">{p.last_at ? `最後：${when(p.last_at)}` : "まだ見回っていません"}{msg ? `・${msg}` : ""}</p>
    </div>
  );
}

// すべてのプロダクトの予定を並べる
export function ScheduleOverview({ rows }: { rows: OverviewRow[] }) {
  const groups = rows[0]?.groups.map((g) => ({ key: g.key, label: g.label })) ?? [];
  return (
    <section className="card overflow-x-auto" aria-label="すべてのプロダクトの予定">
      <h2 className="border-b border-zinc-100 px-4 py-2.5 text-[14px] font-semibold">すべてのプロダクトの予定</h2>
      <table className="w-full text-[12px]">
        <thead className="text-left text-[11px] text-zinc-500">
          <tr><th className="px-4 py-1.5">プロダクト</th>{groups.map((g) => <th key={g.key} className="pr-3">{g.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map((p) => (
            <tr key={p.id} className="align-top">
              <td className="px-4 py-2"><Link href={`/p/${p.id}/schedule`} className="font-medium hover:underline">{p.name}</Link>{!p.set_up && <div className="text-[10.5px] text-zinc-400">まだエージェントを置いていません</div>}</td>
              {p.groups.map((g) => (
                <td key={g.key} className="py-2 pr-3">
                  <div>{g.schedules.join("・") || <span className="text-zinc-400">—</span>}</div>
                  {g.stopped > 0 && <div className="text-[10.5px] text-amber-700">止めている {g.stopped} / {g.total}</div>}
                  {g.next_run_at && <div className="text-[10.5px] text-zinc-500">次 {when(g.next_run_at)}</div>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
