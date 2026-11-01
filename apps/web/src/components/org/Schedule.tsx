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
  next: string[]; last_run_at: string | null; hours: number[]; runs: number[];
};
export type ScheduleView = {
  start: string; now: string; hours: number; groups: { key: string; label: string }[]; agents: SchedAgent[];
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
      <Timeline v={v} versions={versions} sel={sel} toggle={toggle} />
    </div>
  );
}

const hm = (t: number) => `${Math.floor(t / 60) % 24}:${String(t % 60).padStart(2, "0")}`;

// これから24時間の時間割：横が時刻、行がエージェント。動く時刻を細い縦線で打つ（頻繁な予定は帯に、まばらな予定は点に見える）
function Timeline({ v, versions, sel, toggle }: { v: ScheduleView; versions: Record<string, string>; sel: string[]; toggle: (k: string[]) => void }) {
  const total = v.hours * 60;
  const startJst = (() => { const d = new Date(new Date(v.start).toLocaleString("en-US", { timeZone: "Asia/Tokyo" })); return d.getHours() * 60 + d.getMinutes(); })();
  const nowMin = Math.max(0, Math.min(total, (new Date(v.now).getTime() - new Date(v.start).getTime()) / 60000));
  const [hover, setHover] = useState<number | null>(null);
  const pct = (m: number) => `${(m / total) * 100}%`;
  const ticks = Array.from({ length: v.hours / 3 + 1 }, (_, i) => i * 180);
  const LABEL_W = 350; // 名前と予定の列の幅
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left - LABEL_W;
    setHover(x < 0 ? null : Math.max(0, Math.min(total - 1, Math.round((x / (r.width - LABEL_W)) * total))));
  };
  const Row = ({ a }: { a: SchedAgent }) => (
    <div className={`grid grid-cols-[230px_120px_minmax(0,1fr)] items-center border-t border-zinc-100 ${a.enabled ? "" : "opacity-45"}`} data-key={a.key}>
      <label className="flex items-center gap-2 py-1.5 pl-4 text-[12.5px]" title={a.what}>
        <input type="checkbox" checked={sel.includes(a.key)} onChange={() => toggle([a.key])} aria-label={`${a.name}を選ぶ`} className="accent-brand-600" />
        {a.key !== "meeting" && a.key !== "pm_sync" && <Avatar k={a.key} v={versions[a.key]} size={22} />}
        <span className="truncate">{a.name}</span>
      </label>
      <div className="pr-3 text-[12px] text-zinc-500" title={a.next.length ? `次：${a.next.map(when).join("／")}` : ""}>{a.enabled ? a.label : "止めています"}</div>
      <div className="relative h-7">
        <div className="absolute inset-x-0 top-1/2 h-px bg-zinc-100" />
        {a.runs.length >= v.hours * 4 ? (
          // 頻繁な予定（1時間に4回以上）は、細い線を並べず帯で見せる
          <span className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full bg-brand-500/30 ring-1 ring-inset ring-brand-500/40"
            style={{ left: pct(a.runs[0]), width: pct(a.runs[a.runs.length - 1] - a.runs[0]) }} />
        ) : a.runs.map((m) => (
          <span key={m} className="absolute top-1.5 h-4 w-[2px] -translate-x-1/2 rounded-full bg-brand-600" style={{ left: pct(m) }} />
        ))}
      </div>
    </div>
  );
  return (
    <section className="card" aria-label="時間割">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-4 py-2.5">
        <CalendarClock size={15} className="text-brand-600" />
        <h2 className="text-[14px] font-semibold">これから24時間の時間割</h2>
        <span className="text-[11px] text-zinc-500">縦線は動く時刻、帯は1時間に4回以上動く予定。Issue が来たときは予定を待たずにすぐ動きます</span>
      </div>
      <div className="relative">
        {/* 時刻の目盛り（3時間ごと）と、いま・カーソルの位置 */}
        <div className="grid grid-cols-[230px_120px_minmax(0,1fr)] text-[10.5px] text-zinc-400">
          <div className="py-1.5 pl-4">エージェント</div><div>予定</div>
          <div className="relative h-7">
            {ticks.map((m) => (
              <span key={m} className={`absolute top-1.5 tabular-nums ${m === 0 ? "" : m >= total ? "-translate-x-full" : "-translate-x-1/2"}`} style={{ left: pct(m) }}>{hm(startJst + m)}</span>
            ))}
          </div>
        </div>
        <div className="pointer-events-none absolute bottom-0 left-[350px] right-0 top-7">
          {ticks.map((m) => <span key={m} className="absolute inset-y-0 w-px bg-zinc-100" style={{ left: pct(m) }} />)}
          <span className="absolute inset-y-0 w-px bg-rose-400" style={{ left: pct(nowMin) }}><span className="absolute -top-1 left-1 whitespace-nowrap rounded bg-rose-500 px-1 text-[9.5px] text-white">いま</span></span>
          {hover !== null && (
            <span className="absolute inset-y-0 w-px bg-zinc-400" style={{ left: pct(hover) }}>
              <span className="absolute -top-1 left-1 whitespace-nowrap rounded bg-zinc-800 px-1 text-[10px] tabular-nums text-white">{hm(startJst + hover)}</span>
            </span>
          )}
        </div>
        <div onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          {v.groups.map((g) => {
            const rows = v.agents.filter((a) => a.group === g.key);
            const keys = rows.map((a) => a.key);
            return (
              <div key={g.key}>
                <label className="flex items-center gap-2 border-t border-zinc-200 bg-zinc-50/70 py-1 pl-4 text-[11.5px] font-semibold text-zinc-600">
                  <input type="checkbox" checked={keys.every((k) => sel.includes(k))} onChange={() => toggle(keys)} aria-label={`${g.label}をまとめて選ぶ`} className="accent-brand-600" />{g.label}
                </label>
                {rows.map((a) => <Row key={a.key} a={a} />)}
              </div>
            );
          })}
          <div className="grid grid-cols-[230px_120px_minmax(0,1fr)] items-center border-t border-zinc-200 bg-zinc-50/70">
            <div className="py-1.5 pl-4 text-[12.5px] font-medium">プラットフォームの見回り</div>
            <div className="pr-3 text-[12px] text-zinc-500">{v.platform.label}</div>
            <div className="relative h-7">
              {v.platform.every_min <= 15 ? (
                <span className="absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 rounded-full bg-zinc-300/60 ring-1 ring-inset ring-zinc-400/40" />
              ) : Array.from({ length: Math.floor(total / v.platform.every_min) }, (_, i) => i * v.platform.every_min).map((m) => (
                <span key={m} className="absolute top-1.5 h-4 w-[2px] -translate-x-1/2 rounded-full bg-zinc-400" style={{ left: pct(m) }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
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
