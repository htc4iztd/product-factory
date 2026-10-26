// リサーチライブラリの画面で使う、記事・ファクト・プレーヤーの下ごしらえと集計の軸。
// 絞り込みと集計は画面の側で行う（記事数が数千件までなら十分速い）。
import type { ResearchArticle, ResearchData, ResearchFact, ResearchPlayer } from "@/lib/agent";

export type Art = ResearchArticle & {
  m: string; q: string; y: string; jp: boolean; ent: string[]; txt: string; iss: string[]; added: string; head: string;
};
export type Model = {
  arts: Art[]; byKey: Record<string, Art>; byNum: Record<number, Art>; facts: ResearchFact[]; factsBy: Record<string, ResearchFact[]>;
  players: ResearchPlayer[]; entLayer: Record<string, string>; layers: string[]; months: string[]; latestAdded: string;
  issues: string[]; issueQ: Record<string, string>;
};

export const NO_ISSUE = "（論点なし）";
const jst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10);

// 英数字だけの呼び方は語の途中に当たらないようにする（Apple が Pineapple に当たらない）
export function nameRx(names: string[]): RegExp | null {
  const parts = names.filter(Boolean).map((a) => {
    const e = a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return /^[\x00-\x7f]+$/.test(a) ? `(?:^|[^A-Za-z0-9])${e}(?![A-Za-z0-9])` : e;
  });
  return parts.length ? new RegExp(parts.join("|")) : null;
}

export function quarter(m: string) {
  return `${m.slice(0, 4)} Q${Math.floor((Number(m.slice(5, 7)) - 1) / 3) + 1}`;
}

export function buildModel(d: ResearchData): Model {
  const rx = d.players.map((p) => ({ p, rx: nameRx([p.name, ...p.aliases]) }));
  const entLayer: Record<string, string> = {};
  d.players.forEach((p) => { entLayer[p.name] = p.layer; });
  const alias: Record<string, string> = {};
  d.players.forEach((p) => p.aliases.forEach((a) => { alias[a] = p.name; }));
  const factsBy: Record<string, ResearchFact[]> = {};
  d.facts.forEach((f) => { (factsBy[f.article] ??= []).push(f); });
  const arts: Art[] = d.items.map((a) => {
    const head = a.title_ja || a.title;
    const txt = `${a.publisher} ${a.title} ${a.title_ja} ${a.summary}`;
    const ent = new Set<string>();
    rx.forEach(({ p, rx }) => { if (rx && rx.test(txt)) ent.add(p.name); });
    a.entities.forEach((e) => ent.add(alias[e] ?? e));
    const m = (a.published ?? a.added_at.slice(0, 10)).slice(0, 7);
    return {
      ...a, head, m, q: quarter(m), y: m.slice(0, 4), jp: a.region === "domestic" || a.country === "JP", ent: [...ent],
      txt: `${txt} ${a.category} ${a.memo}`.toLowerCase(), iss: a.issues.length ? a.issues : [NO_ISSUE], added: jst(a.added_at),
    };
  }).sort((x, y) => ((y.published ?? "") < (x.published ?? "") ? -1 : (y.published ?? "") > (x.published ?? "") ? 1 : y.number - x.number));
  const byKey: Record<string, Art> = {}, byNum: Record<number, Art> = {};
  arts.forEach((a) => { byKey[a.key] = a; byNum[a.number] = a; });
  arts.forEach((a) => a.ent.forEach((e) => { entLayer[e] ??= "（未登録）"; }));
  return {
    arts, byKey, byNum, facts: d.facts, factsBy, players: d.players, entLayer, layers: [...d.layers, "（未登録）"],
    months: [...new Set(arts.map((a) => a.m))].sort(), latestAdded: arts.reduce((x, a) => (a.added > x ? a.added : x), ""),
    issues: d.issues, issueQ: d.issue_defs ?? {},
  };
}

// 層ごとの色（マップ・企業の一覧・関係図で同じ色）
const PALETTE = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#14b8a6", "#ef4444", "#84cc16", "#64748b"];
export function layerColor(layers: string[], layer: string | undefined) {
  const i = layers.indexOf(layer ?? "");
  return i < 0 || layer === "（未登録）" ? "#a1a1aa" : PALETTE[i % PALETTE.length];
}

// 分析の絞り込み（全部の分析の画面に効く）
export type AF = { from: string; to: string; reg: "all" | "jp" | "ov"; cat: string; iss: string; ent: string; q: string };
export const AF0: AF = { from: "", to: "", reg: "all", cat: "", iss: "", ent: "", q: "" };
export function inAF(a: Art, f: AF) {
  if (f.from && a.m < f.from) return false;
  if (f.to && a.m > f.to) return false;
  if (f.reg === "jp" && !a.jp) return false;
  if (f.reg === "ov" && a.jp) return false;
  if (f.cat && a.category !== f.cat) return false;
  if (f.iss && !a.iss.includes(f.iss)) return false;
  if (f.ent && !a.ent.includes(f.ent)) return false;
  if (f.q && !a.txt.includes(f.q.toLowerCase())) return false;
  return true;
}

// 集計の軸。f は記事（とファクト）から値の配列を返す。1件が複数の値に入る軸は multi
export type Dim = { l: string; f: (a: Art, fact: ResearchFact | null, M: Model) => string[]; multi?: boolean; time?: boolean; top?: number };
const yes = (b: boolean) => [b ? "あり" : "なし"];
export function dims(labels: { cat: Record<string, string>; kind: Record<string, string> }, extra: { memo: (a: Art) => boolean; qa: (a: Art) => boolean }): Record<string, Dim> {
  const fk = (a: Art, f: ResearchFact | null, M: Model, k: "kind" | "theme") => {
    if (f) return [k === "kind" ? labels.kind[f.kind] ?? f.kind : f.theme || "不明"];
    const s = [...new Set((M.factsBy[a.key] ?? []).map((x) => (k === "kind" ? labels.kind[x.kind] ?? x.kind : x.theme || "不明")))];
    return s.length ? s : ["ファクトなし"];
  };
  return {
    iss: { l: "論点", multi: true, f: (a) => a.iss },
    iss1: { l: "主な論点", f: (a) => [a.iss[0]] },
    cat: { l: "区分", f: (a) => [labels.cat[a.category] ?? a.category] },
    reg: { l: "国内・海外", f: (a) => [a.jp ? "国内" : "海外"] },
    cty: { l: "国・地域", f: (a) => [a.jp ? "JP" : a.country || "不明"] },
    y: { l: "年", time: true, f: (a) => [a.y] },
    q: { l: "四半期", time: true, f: (a) => [a.q] },
    m: { l: "月", time: true, f: (a) => [a.m] },
    ent: { l: "企業・団体（上位20）", multi: true, top: 20, f: (a) => (a.ent.length ? a.ent : ["（該当なし）"]) },
    grp: { l: "企業の層", multi: true, f: (a, _f, M) => { const g = [...new Set(a.ent.map((e) => M.entLayer[e]))]; return g.length ? g : ["（該当なし）"]; } },
    fk: { l: "ファクトの種類", multi: true, f: (a, f, M) => fk(a, f, M, "kind") },
    ft: { l: "ファクトのテーマ", multi: true, f: (a, f, M) => fk(a, f, M, "theme") },
    hasf: { l: "ファクトの有無", f: (a, _f, M) => yes(!!(M.factsBy[a.key] ?? []).length) },
    memo: { l: "メモの有無", f: (a) => yes(extra.memo(a)) },
    qa: { l: "質問の有無", f: (a) => yes(extra.qa(a)) },
  };
}

export function pct(x: number) {
  return `${(x * 100).toFixed(x < 0.1 && x > 0 ? 1 : 0)}%`;
}

// ヒートマップのセルの色（0〜1）
export function heat(v: number, max: number): React.CSSProperties {
  if (!v || !max) return {};
  const p = Math.round(10 + 70 * Math.min(1, v / max));
  return { background: `color-mix(in srgb, #6366f1 ${p}%, white)`, color: p > 52 ? "white" : undefined };
}

export function periods(arts: Art[], g: "q" | "m"): string[] {
  if (!arts.length) return [];
  const ms = arts.map((a) => a.m).sort();
  let y = Number(ms[0].slice(0, 4)), m = Number(ms[0].slice(5, 7));
  const last = ms[ms.length - 1], out: string[] = [];
  for (;;) {
    const k = `${y}-${String(m).padStart(2, "0")}`;
    const p = g === "q" ? quarter(k) : k;
    if (out[out.length - 1] !== p) out.push(p);
    if (k >= last) break;
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

export function csvDownload(name: string, rows: (string | number | null | undefined)[][]) {
  const q = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const blob = new Blob(["﻿" + rows.map((r) => r.map(q).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
