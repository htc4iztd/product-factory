"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Layers, Plus, X } from "lucide-react";
import type { DiagramValue, FieldSpec, FrameworkDefT, FrameworkPart, MatrixValue, PositioningValue, StageDetail } from "@/lib/agent";
import { setStageFrameworks } from "@/app/(app)/p/[id]/s/[stage]/actions";
import { FieldEditor } from "@/components/stage/FieldEditor";
import { DiagramBlock, MatrixBlock, PositioningBlock } from "./Blocks";

// 工程に足したフレームワーク：部品を 12 列の格子に並べて描く。足す・外す・必須にする
export function FrameworkParts({ pid, st, readOnly, library }: { pid: string; st: StageDetail; readOnly: boolean; library: FrameworkDefT[] }) {
  const parts = st.framework.parts ?? [];
  const [pending, start] = useTransition();
  const [picking, setPicking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const items = parts.map((p) => ({ id: p.id, required: p.required }));
  const update = (next: { id: string; required: boolean }[]) => start(async () => { const r = await setStageFrameworks(pid, st.id, next); setMsg(r.error ?? null); });
  const have = new Set(parts.map((p) => p.id));
  const suggested = library.filter((f) => !have.has(f.id) && f.stages.includes(st.id));
  const others = library.filter((f) => !have.has(f.id) && !f.stages.includes(st.id));
  return (
    <section className="space-y-4" aria-label="足したフレームワーク">
      <div className="flex flex-wrap items-center gap-2">
        <Layers size={15} className="text-brand-600" />
        <h2 className="text-[14px] font-semibold">フレームワーク</h2>
        <span className="text-[11.5px] text-zinc-500">この工程に足した分析（{parts.length}）。AI と下流の工程もすべて読みます</span>
        {!readOnly && <button className="btn-secondary btn-sm ml-auto" onClick={() => setPicking((x) => !x)}><Plus size={12} />フレームワークを足す</button>}
        <Link href={`/p/${pid}/frameworks`} className="text-[11.5px] text-brand-700 hover:underline">ライブラリとエディタ</Link>
      </div>
      {msg && <p className="text-[12px] text-rose-600">{msg}</p>}
      {picking && (
        <div className="card space-y-2 p-3" aria-label="足すフレームワークを選ぶ">
          {[["この工程に向いている", suggested], ["そのほか", others]].map(([title, list]) => (list as FrameworkDefT[]).length > 0 && (
            <div key={title as string}>
              <div className="mb-1 text-[11px] font-semibold text-zinc-500">{title as string}</div>
              <div className="flex flex-wrap gap-1.5">
                {(list as FrameworkDefT[]).map((f) => (
                  <button key={f.id} disabled={pending} title={f.description} onClick={() => { update([...items, { id: f.id, required: false }]); setPicking(false); }}
                    className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[12px] hover:border-brand-300 hover:bg-brand-50">
                    {f.name}<span className="ml-1 text-[10px] text-zinc-400">{f.category}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {parts.map((p) => (
        <Part key={p.id} pid={pid} st={st} part={p} readOnly={readOnly}
          onRequired={(v) => update(items.map((x) => (x.id === p.id ? { ...x, required: v } : x)))}
          onRemove={() => update(items.filter((x) => x.id !== p.id))} busy={pending} />
      ))}
    </section>
  );
}

function Part({ pid, st, part, readOnly, onRequired, onRemove, busy }: {
  pid: string; st: StageDetail; part: FrameworkPart; readOnly: boolean; onRequired: (v: boolean) => void; onRemove: () => void; busy: boolean;
}) {
  const rows = Math.max(1, ...part.blocks.map((b) => b.layout.y + b.layout.h));
  return (
    <div className="card p-4" data-part={part.id} aria-label={part.name}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-[14px] font-semibold">{part.name}</h3>
        {part.category && <span className="rounded bg-zinc-100 px-1.5 text-[10.5px] text-zinc-600">{part.category}</span>}
        {part.required && <span className="rounded bg-rose-50 px-1.5 text-[10.5px] font-medium text-rose-700">必須</span>}
        <span className="text-[11.5px] text-zinc-500">{part.description}</span>
        {!readOnly && (
          <span className="ml-auto flex items-center gap-2">
            <label className="flex items-center gap-1 text-[11.5px] text-zinc-600"><input type="checkbox" checked={part.required} disabled={busy} onChange={(e) => onRequired(e.target.checked)} />必須にする</label>
            <button className="btn-ghost btn-sm h-7 px-1.5 text-zinc-400 hover:text-rose-600" disabled={busy} onClick={onRemove} aria-label={`${part.name}を外す`}><X size={13} /></button>
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-12" style={{ gridTemplateRows: `repeat(${rows}, minmax(0, auto))` }}>
        {part.blocks.map((b) => {
          const key = `${part.id}.${b.key}`;
          const field = st.framework.fields.find((f) => f.key === key) as FieldSpec | undefined;
          const value = st.draft[key];
          return (
            <div key={b.key} className="min-w-0 rounded-lg border border-zinc-100 bg-zinc-50/40 p-3"
              style={{ gridColumn: `${b.layout.x + 1} / span ${b.layout.w}`, gridRow: `${b.layout.y + 1} / span ${b.layout.h}` }} data-block={b.key}>
              <div className="mb-1.5 text-[12.5px] font-semibold text-zinc-800">{b.label}</div>
              {b.hint && <div className="mb-1.5 text-[11px] text-zinc-500">{b.hint}</div>}
              {b.kind === "matrix" ? <MatrixBlock pid={pid} sid={st.id} fieldKey={key} block={b} value={value as MatrixValue} readOnly={readOnly} />
                : b.kind === "positioning" ? <PositioningBlock pid={pid} sid={st.id} fieldKey={key} block={b} value={value as PositioningValue} readOnly={readOnly} />
                : b.kind === "diagram" ? <DiagramBlock pid={pid} sid={st.id} fieldKey={key} block={b} value={value as DiagramValue} readOnly={readOnly} />
                : field ? <FieldEditor pid={pid} sid={st.id} field={field} value={value} readOnly={readOnly} hasProposal={false} hideLabel compact /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
