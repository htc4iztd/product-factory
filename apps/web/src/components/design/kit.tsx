"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Maximize2, Minimize2, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import type { FieldValue } from "@/lib/agent";
import { setField } from "@/app/(app)/p/[id]/s/[stage]/actions";

// 設計エディタの共通部品：手元の値・保存・全画面・行を足し引きできる小さな表・自動の並べ方

let seq = 0;
export const uid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

// 値を手元に写して編集し、「保存」でまとめて書き戻す。サーバーの値が変わったら写し直す
export function useEditable<T extends FieldValue>(pid: string, sid: string, key: string, value: T) {
  const initial = useMemo(() => structuredClone(value), [value]);
  const [v, setV] = useState<T>(initial);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => { setV(initial); setDirty(false); }, [initial]);
  const change = (fn: (x: T) => T) => { setV((x) => fn(x)); setDirty(true); setError(null); };
  const save = () => start(async () => {
    const r = await setField(pid, sid, key, v);
    if (r.error) setError(r.error); else setDirty(false);
  });
  const reset = () => { setV(initial); setDirty(false); setError(null); };
  return { v, change, dirty, error, pending, save, reset };
}

export function SaveBar({ e, label = "保存" }: { e: { dirty: boolean; pending: boolean; error: string | null; save: () => void; reset: () => void }; label?: string }) {
  return (
    <div className="flex items-center gap-2">
      {e.error && <span className="text-[11px] text-rose-600">{e.error}</span>}
      {e.dirty && !e.error && <span className="text-[11px] text-amber-600">保存していない変更があります</span>}
      <button disabled={!e.dirty || e.pending} onClick={e.reset} className="btn-ghost btn-sm" aria-label="変更を取り消す"><RotateCcw size={12} /></button>
      <button disabled={!e.dirty || e.pending} onClick={e.save} className="btn-primary btn-sm"><Save size={12} />{e.pending ? "保存中…" : label}</button>
    </div>
  );
}

// 図を全画面に広げられる枠
export function Expandable({ children, toolbar }: { children: (full: boolean) => React.ReactNode; toolbar?: React.ReactNode }) {
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFull(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);
  return (
    <div className={full ? "fixed inset-0 z-50 flex flex-col gap-2 overflow-y-auto bg-zinc-50 p-4" : "space-y-2"}>
      <div className="flex flex-wrap items-center gap-1.5">
        {toolbar}
        <button onClick={() => setFull((x) => !x)} className="btn-secondary btn-sm ml-auto" title={full ? "元に戻す（Esc）" : "全画面で編集"}>
          {full ? <><Minimize2 size={12} />元に戻す</> : <><Maximize2 size={12} />全画面</>}
        </button>
      </div>
      {children(full)}
    </div>
  );
}

// ---------- 小さな表（行の追加・削除、文字・選択・チェック・CRUD） ----------
export type Col<R> = {
  key: keyof R & string; label: string; kind?: "text" | "select" | "check" | "crud" | "area";
  options?: readonly string[] | { value: string; label: string }[]; width?: string; placeholder?: string; list?: string;
};

export function MiniTable<R extends Record<string, unknown>>({ cols, rows, onChange, blank, readOnly, addLabel = "行を追加", empty, onRowClick, active }: {
  cols: Col<R>[]; rows: R[]; onChange: (rows: R[]) => void; blank: () => R; readOnly?: boolean; addLabel?: string; empty?: string;
  onRowClick?: (i: number) => void; active?: number;
}) {
  const set = (i: number, k: string, v: unknown) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="space-y-1.5">
      <div className="overflow-x-auto rounded-lg border border-zinc-200">
        <table className="w-full border-collapse text-[12px]">
          <thead className="bg-zinc-50">
            <tr>
              {cols.map((c) => <th key={c.key} style={{ width: c.width }} className="whitespace-nowrap px-2 py-1.5 text-left font-medium text-zinc-500">{c.label}</th>)}
              {!readOnly && <th className="w-8" />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={cols.length + 1} className="px-2 py-3 text-center text-zinc-400">{empty ?? "まだありません"}</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={i} onClick={onRowClick ? () => onRowClick(i) : undefined}
                className={`border-t border-zinc-100 ${onRowClick ? "cursor-pointer" : ""} ${active === i ? "bg-brand-50/60" : ""}`}>
                {cols.map((c) => <td key={c.key} className="p-0.5 align-top"><Cell c={c} v={r[c.key]} readOnly={readOnly} onChange={(v) => set(i, c.key, v)} /></td>)}
                {!readOnly && (
                  <td className="p-0.5 text-center align-top">
                    <button type="button" onClick={(e) => { e.stopPropagation(); onChange(rows.filter((_, j) => j !== i)); }} className="btn-ghost btn-sm px-1" title="行を削除" aria-label="行を削除"><Trash2 size={12} /></button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!readOnly && <button type="button" onClick={() => onChange([...rows, blank()])} className="btn-ghost btn-sm"><Plus size={12} />{addLabel}</button>}
    </div>
  );
}

const inputCls = "w-full min-w-[4rem] rounded-md border border-transparent bg-transparent px-1.5 py-1 outline-none placeholder:text-zinc-300 hover:border-zinc-200 focus:border-brand-500 focus:bg-white disabled:hover:border-transparent";

function Cell<R>({ c, v, onChange, readOnly }: { c: Col<R>; v: unknown; onChange: (v: unknown) => void; readOnly?: boolean }) {
  if (c.kind === "check") {
    return <div className="flex justify-center py-1"><input type="checkbox" checked={Boolean(v)} disabled={readOnly} aria-label={c.label} onChange={(e) => onChange(e.target.checked)} /></div>;
  }
  if (c.kind === "crud") return <CrudToggle value={String(v ?? "")} onChange={onChange} readOnly={readOnly} />;
  if (c.kind === "select") {
    const opts = (c.options ?? []).map((o) => (typeof o === "string" ? { value: o, label: o } : o));
    return (
      <select value={String(v ?? "")} disabled={readOnly} aria-label={c.label} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        {!opts.some((o) => o.value === "") && <option value="">—</option>}
        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  if (c.kind === "area") {
    return <textarea value={String(v ?? "")} readOnly={readOnly} aria-label={c.label} placeholder={c.placeholder ?? c.label} rows={1}
      onChange={(e) => onChange(e.target.value)} className={`${inputCls} field-sizing-content resize-none`} />;
  }
  return <input value={String(v ?? "")} readOnly={readOnly} aria-label={c.label} list={c.list} placeholder={c.placeholder ?? c.label} onChange={(e) => onChange(e.target.value)} className={inputCls} />;
}

// C / R / U / D を1つずつ切り替える
export function CrudToggle({ value, onChange, readOnly, compact }: { value: string; onChange: (v: string) => void; readOnly?: boolean; compact?: boolean }) {
  const color: Record<string, string> = { C: "bg-emerald-500", R: "bg-sky-500", U: "bg-amber-500", D: "bg-rose-500" };
  return (
    <div className="flex justify-center gap-0.5 py-0.5">
      {["C", "R", "U", "D"].map((k) => {
        const on = value.includes(k);
        return (
          <button key={k} type="button" disabled={readOnly} aria-pressed={on} aria-label={k}
            onClick={(e) => { e.stopPropagation(); onChange(["C", "R", "U", "D"].filter((x) => (x === k ? !on : value.includes(x))).join("")); }}
            className={`${compact ? "h-5 w-5 text-[10px]" : "h-6 w-6 text-[11px]"} rounded font-bold transition ${on ? `${color[k]} text-white` : "bg-zinc-100 text-zinc-300 hover:text-zinc-500"} disabled:cursor-default`}>
            {k}
          </button>
        );
      })}
    </div>
  );
}

// ---------- 位置のない図を自動で並べる（左から右へ、つながりの深さで列を決める） ----------
export function layered(ids: string[], edges: { source: string; target: string }[], gx = 260, gy = 140): Record<string, { x: number; y: number }> {
  const rank: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  for (let k = 0; k < ids.length; k++) {
    let moved = false;
    for (const e of edges) {
      if (e.source === e.target || !(e.source in rank) || !(e.target in rank)) continue;
      if (rank[e.target] < rank[e.source] + 1 && rank[e.source] + 1 < ids.length) { rank[e.target] = rank[e.source] + 1; moved = true; }
    }
    if (!moved) break;
  }
  const cols: Record<number, string[]> = {};
  for (const id of ids) (cols[rank[id]] ??= []).push(id);
  const out: Record<string, { x: number; y: number }> = {};
  for (const [r, list] of Object.entries(cols)) list.forEach((id, i) => { out[id] = { x: Number(r) * gx, y: i * gy }; });
  return out;
}

// 2つの箱の位置から、矢印をどの辺から出してどの辺に入れるかを決める（左右に離れていれば左右、上下なら上下）
export function sides(a: { x: number; y: number } | undefined, b: { x: number; y: number } | undefined) {
  if (!a || !b) return { sourceHandle: "r", targetHandle: "l" };
  const dx = b.x - a.x, dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy) * 0.8) return dx >= 0 ? { sourceHandle: "r", targetHandle: "l" } : { sourceHandle: "l", targetHandle: "r" };
  return dy >= 0 ? { sourceHandle: "b", targetHandle: "t" } : { sourceHandle: "t", targetHandle: "b" };
}
