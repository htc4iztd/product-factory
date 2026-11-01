// 予定の選び方（画面）と cron（内部の表し方）の行き来。読めない cron は「詳しい設定」に残す
export type Sched =
  | { mode: "every"; minutes: number }
  | { mode: "hourly"; minute: number; hours: number }
  | { mode: "daily" | "weekdays"; time: string }
  | { mode: "weekly"; days: number[]; time: string }
  | { mode: "custom"; cron: string };

export const MODES: [Sched["mode"], string][] = [
  ["every", "◯分ごと"], ["hourly", "◯時間ごと"], ["daily", "毎日"], ["weekdays", "平日"], ["weekly", "曜日を選ぶ"], ["custom", "詳しい設定（cron）"],
];
export const EVERY_MIN = [5, 10, 15, 20, 30];
export const EVERY_HOURS = [1, 2, 3, 4, 6, 8, 12];
export const DAYS = ["日", "月", "火", "水", "木", "金", "土"];

const hm = (t: string) => { const [h, m] = t.split(":").map((x) => parseInt(x, 10)); return [Number.isFinite(h) ? h : 9, Number.isFinite(m) ? m : 0]; };
const pad = (n: number) => String(n).padStart(2, "0");

export function toCron(s: Sched): string {
  switch (s.mode) {
    case "every": return `*/${s.minutes} * * * *`;
    case "hourly": return s.hours === 1 ? `${s.minute} * * * *` : `${s.minute} */${s.hours} * * *`;
    case "daily": { const [h, m] = hm(s.time); return `${m} ${h} * * *`; }
    case "weekdays": { const [h, m] = hm(s.time); return `${m} ${h} * * 1-5`; }
    case "weekly": { const [h, m] = hm(s.time); return `${m} ${h} * * ${[...s.days].sort().join(",") || "1"}`; }
    case "custom": return s.cron.trim().split(/\s+/).join(" ");
  }
}

export function fromCron(expr: string): Sched {
  const p = expr.trim().split(/\s+/);
  if (p.length !== 5) return { mode: "custom", cron: expr };
  const [mi, h, d, mo, w] = p;
  const num = (x: string) => /^\d+$/.test(x);
  let m: RegExpMatchArray | null;
  if ((m = mi.match(/^\*\/(\d+)$/)) && h === "*" && d === "*" && mo === "*" && w === "*" && EVERY_MIN.includes(+m[1])) return { mode: "every", minutes: +m[1] };
  if (num(mi) && h === "*" && d === "*" && mo === "*" && w === "*") return { mode: "hourly", minute: +mi, hours: 1 };
  if (num(mi) && (m = h.match(/^\*\/(\d+)$/)) && d === "*" && mo === "*" && w === "*" && EVERY_HOURS.includes(+m[1])) return { mode: "hourly", minute: +mi, hours: +m[1] };
  if (num(mi) && num(h) && d === "*" && mo === "*") {
    const time = `${pad(+h)}:${pad(+mi)}`;
    if (w === "*") return { mode: "daily", time };
    if (w === "1-5") return { mode: "weekdays", time };
    if (/^\d(,\d)*$/.test(w)) return { mode: "weekly", days: w.split(",").map((x) => +x % 7), time };
  }
  return { mode: "custom", cron: expr };
}

export function defaultFor(mode: Sched["mode"], prev: Sched): Sched {
  const cron = toCron(prev);
  switch (mode) {
    case "every": return { mode, minutes: 10 };
    case "hourly": return { mode, minute: 0, hours: 1 };
    case "daily": case "weekdays": return { mode, time: "18:00" };
    case "weekly": return { mode, days: [1], time: "09:00" };
    case "custom": return { mode, cron };
  }
}
