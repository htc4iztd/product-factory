"use client";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  Background, Controls, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow,
  type Connection, type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import { GitBranchPlus, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import type { Row } from "@/lib/agent";
import { setField } from "@/app/(app)/p/[id]/s/[stage]/actions";

type Kpi = { id: string; name: string; parent: string | null; relation: string; target: string; measure: string };
type KpiNodeData = { kpi: Kpi; childCount: number; selected: boolean };

const W = 190, GAP_X = 24, GAP_Y = 120;
const REL: Record<string, string> = { "×": "子の掛け算", "+": "子の足し算" };
let seq = 0;
const newId = () => `k${Date.now().toString(36)}${(seq++).toString(36)}`;

function fromRows(rows: Row[]): Kpi[] {
  const items = rows.filter((r) => String(r.kpi ?? "").trim());
  const ids = new Map(items.map((r) => [String(r.kpi), newId()]));
  return items.map((r) => ({
    id: ids.get(String(r.kpi))!, name: String(r.kpi), parent: ids.get(String(r.parent ?? "")) ?? null,
    relation: String(r.relation ?? ""), target: String(r.target ?? ""), measure: String(r.measure ?? ""),
  }));
}

function toRows(kpis: Kpi[]): Row[] {
  const name = new Map(kpis.map((k) => [k.id, k.name.trim()]));
  return kpis.map((k) => ({ kpi: k.name.trim(), parent: k.parent ? name.get(k.parent) ?? "" : "", relation: k.relation, target: k.target, measure: k.measure }));
}

// 親子から木の配置を決める（葉を左から順に並べ、親は子の中央に置く）
function layout(kpis: Kpi[]): Map<string, { x: number; y: number }> {
  const children = new Map<string | null, Kpi[]>();
  for (const k of kpis) children.set(k.parent, [...(children.get(k.parent) ?? []), k]);
  const pos = new Map<string, { x: number; y: number }>();
  let slot = 0;
  const place = (k: Kpi, depth: number, seen: Set<string>): number => {
    if (seen.has(k.id)) return 0;
    seen.add(k.id);
    const kids = children.get(k.id) ?? [];
    const x = kids.length ? kids.map((c) => place(c, depth + 1, seen)).reduce((a, b) => a + b, 0) / kids.length : slot++ * (W + GAP_X);
    pos.set(k.id, { x, y: depth * GAP_Y });
    return x;
  };
  const seen = new Set<string>();
  for (const r of children.get(null) ?? []) place(r, 0, seen);
  return pos;
}

function isDescendant(kpis: Kpi[], node: string, of: string): boolean {
  let cur = kpis.find((k) => k.id === node)?.parent ?? null;
  while (cur) {
    if (cur === of) return true;
    cur = kpis.find((k) => k.id === cur)?.parent ?? null;
  }
  return false;
}

function KpiNode({ data }: NodeProps<Node<KpiNodeData>>) {
  const { kpi, childCount, selected } = data;
  return (
    <div className={`w-[190px] rounded-xl border bg-white px-3 py-2 shadow-card transition ${selected ? "border-brand-500 ring-4 ring-brand-100" : kpi.parent ? "border-zinc-200" : "border-brand-200 bg-brand-50"}`}>
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-zinc-300 !bg-white" />
      <div className="truncate text-[12px] font-semibold text-zinc-900">{kpi.name || "（名前なし）"}</div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-zinc-500">
        {kpi.target ? <span className="truncate tabular-nums">目標 {kpi.target}</span> : <span className="text-zinc-300">目標未設定</span>}
        {childCount > 0 && kpi.relation && <span className="ml-auto shrink-0 rounded bg-zinc-100 px-1 font-medium text-zinc-600">= 子 {kpi.relation}</span>}
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-brand-500 !bg-brand-500" />
    </div>
  );
}
const nodeTypes = { kpi: KpiNode };

function Editor({ pid, sid, rows, readOnly }: { pid: string; sid: string; rows: Row[]; readOnly: boolean }) {
  const initial = useMemo(() => fromRows(rows), [rows]);
  const [kpis, setKpis] = useState<Kpi[]>(initial);
  const [sel, setSel] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const flow = useReactFlow();

  useEffect(() => { setKpis(initial); setDirty(false); setSel(null); }, [initial]);
  useEffect(() => { const t = setTimeout(() => flow.fitView({ padding: 0.2, duration: 200 }), 30); return () => clearTimeout(t); }, [kpis.length, flow]);

  const pos = layout(kpis);
  const childCount = (id: string) => kpis.filter((k) => k.parent === id).length;
  const nodes: Node<KpiNodeData>[] = kpis.map((k) => ({
    id: k.id, type: "kpi", position: pos.get(k.id) ?? { x: 0, y: 0 },
    data: { kpi: k, childCount: childCount(k.id), selected: k.id === sel },
  }));
  const edges: Edge[] = kpis.filter((k) => k.parent).map((k) => {
    const rel = kpis.find((p) => p.id === k.parent)?.relation;
    return {
      id: `${k.parent}-${k.id}`, source: k.parent!, target: k.id, type: "smoothstep",
      label: rel || undefined, labelStyle: { fontSize: 11, fontWeight: 600, fill: "#4547c4" },
      labelBgStyle: { fill: "#eef0fe" }, labelBgPadding: [4, 2] as [number, number], style: { stroke: "#a1a1aa" },
    };
  });

  const update = (fn: (ks: Kpi[]) => Kpi[]) => { setKpis(fn); setDirty(true); setError(null); };
  const selected = kpis.find((k) => k.id === sel) ?? null;
  const patch = (p: Partial<Kpi>) => selected && update((ks) => ks.map((k) => (k.id === selected.id ? { ...k, ...p } : k)));
  const add = (parent: string | null) => {
    const id = newId();
    update((ks) => [...ks, { id, name: parent ? "新しい子KPI" : "最上位KPI", parent, relation: "", target: "", measure: "" }]);
    setSel(id);
  };
  const remove = (id: string) => {
    const gone = kpis.find((k) => k.id === id);
    update((ks) => ks.filter((k) => k.id !== id).map((k) => (k.parent === id ? { ...k, parent: gone?.parent ?? null } : k)));
    setSel(null);
  };
  const connect = (c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return;
    if (isDescendant(kpis, c.source, c.target)) { setError("循環になるため、つなげません"); return; }
    update((ks) => ks.map((k) => (k.id === c.target ? { ...k, parent: c.source } : k)));
  };
  const save = () => {
    const names = kpis.map((k) => k.name.trim());
    if (names.some((n) => !n)) return setError("名前が空のKPIがあります");
    if (new Set(names).size !== names.length) return setError("KPIの名前が重複しています（親子は名前でつながるため一意にしてください）");
    start(async () => {
      const r = await setField(pid, sid, "kpi_tree", toRows(kpis));
      if (r.error) setError(r.error); else setDirty(false);
    });
  };

  return (
    <div className="flex h-[460px] overflow-hidden rounded-xl border border-zinc-200">
      <div className="relative min-w-0 flex-1 bg-zinc-50">
        <ReactFlow
          nodes={nodes} edges={edges} nodeTypes={nodeTypes}
          nodesDraggable={false} nodesConnectable={!readOnly} elementsSelectable={!readOnly}
          onNodeClick={(_, n) => setSel(n.id)} onPaneClick={() => setSel(null)}
          onConnect={connect}
          onEdgesDelete={(es) => update((ks) => ks.map((k) => (es.some((e) => e.target === k.id) ? { ...k, parent: null } : k)))}
          onNodesDelete={(ns) => ns.forEach((n) => remove(n.id))}
          deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
          fitView proOptions={{ hideAttribution: true }} minZoom={0.3}
        >
          <Background gap={16} color="#e4e4e7" />
          <Controls showInteractive={false} position="bottom-left" />
        </ReactFlow>
        {kpis.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] text-zinc-400">
            右の「最上位のKPIを追加」から始めるか、AIに下書きを頼んでください
          </div>
        )}
      </div>
      {!readOnly && (
        <div className="flex w-64 shrink-0 flex-col gap-3 border-l border-zinc-200 bg-white p-3 text-[12px]">
          {selected ? (
            <>
              <div className="font-semibold">KPIを編集</div>
              <label className="block"><span className="label">名前</span>
                <input className="input" value={selected.name} onChange={(e) => patch({ name: e.target.value })} /></label>
              <label className="block"><span className="label">目標値</span>
                <input className="input" value={selected.target} onChange={(e) => patch({ target: e.target.value })} placeholder="例：月1,200万円" /></label>
              <label className="block"><span className="label">計測方法</span>
                <input className="input" value={selected.measure} onChange={(e) => patch({ measure: e.target.value })} /></label>
              <label className="block"><span className="label">分解の式（子KPIの組み立て方）</span>
                <select className="input" value={selected.relation} onChange={(e) => patch({ relation: e.target.value })}>
                  <option value="">指定なし</option>
                  {Object.entries(REL).map(([k, v]) => <option key={k} value={k}>{k}（{v}）</option>)}
                </select></label>
              <div className="flex gap-2">
                <button onClick={() => add(selected.id)} className="btn-secondary btn-sm flex-1"><GitBranchPlus size={12} />子KPIを追加</button>
                <button onClick={() => remove(selected.id)} className="btn-danger btn-sm" aria-label="このKPIを削除"><Trash2 size={12} /></button>
              </div>
            </>
          ) : (
            <>
              <div className="font-semibold">KPIツリー</div>
              <p className="text-[11px] leading-5 text-zinc-500">
                KPIを選ぶと編集できます。下の点から別のKPIの上の点へドラッグすると、親子をつなぎ替えます。線を選んで Delete で親子を外します。
              </p>
              <button onClick={() => add(null)} className="btn-secondary btn-sm"><Plus size={12} />最上位のKPIを追加</button>
            </>
          )}
          <div className="mt-auto space-y-2 border-t border-zinc-100 pt-3">
            {error && <p className="text-[11px] text-rose-600">{error}</p>}
            <div className="flex gap-2">
              <button disabled={!dirty || pending} onClick={save} className="btn-primary btn-sm flex-1"><Save size={12} />{pending ? "保存中…" : "変更を保存"}</button>
              <button disabled={!dirty || pending} onClick={() => { setKpis(initial); setDirty(false); setError(null); }} className="btn-ghost btn-sm" aria-label="変更を取り消す"><RotateCcw size={12} /></button>
            </div>
            {dirty && <p className="text-[10px] text-amber-600">保存していない変更があります</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export function KpiGraph(props: { pid: string; sid: string; rows: Row[]; readOnly: boolean }) {
  return <ReactFlowProvider><Editor {...props} /></ReactFlowProvider>;
}
