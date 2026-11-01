"use client";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, addEdge, useEdgesState, useNodesState, type Connection, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Plus, Save, Star, Trash2 } from "lucide-react";
import type { Axis, BlockDef, DiagramValue, FieldValue, MatrixValue, PositioningValue } from "@/lib/agent";
import { setField } from "@/app/(app)/p/[id]/s/[stage]/actions";

// フレームワークの部品（matrix・positioning・diagram）の編集。保存すると工程の下書きに入る
type P<V> = { pid: string; sid: string; fieldKey: string; block: BlockDef; value: V | undefined; readOnly: boolean; onPreview?: boolean };

function useSave(pid: string, sid: string, key: string) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const save = (v: FieldValue) => start(async () => { const r = await setField(pid, sid, key, v); setMsg(r.error ?? "保存しました"); });
  return { pending, msg, save, setMsg };
}

function SaveBar({ dirty, pending, msg, onSave }: { dirty: boolean; pending: boolean; msg: string | null; onSave: () => void }) {
  if (!dirty && !msg) return null;
  return (
    <div className="mt-2 flex items-center gap-2">
      {dirty && <button className="btn-primary btn-sm" disabled={pending} onClick={onSave}><Save size={12} />{pending ? "保存中…" : "保存"}</button>}
      {msg && !dirty && <span className="text-[11px] text-zinc-500">{msg}</span>}
    </div>
  );
}

const Q = ["q1", "q2", "q3", "q4"] as const;
const QTONE = ["bg-emerald-50/70", "bg-rose-50/60", "bg-sky-50/70", "bg-amber-50/70"];

// 2×2 の象限（SWOT・アンゾフ・ERRC など）。各象限は1行に1つ
export function MatrixBlock({ pid, sid, fieldKey, block, value, readOnly }: P<MatrixValue>) {
  const init = useMemo(() => Object.fromEntries(Q.map((q) => [q, (value?.[q] ?? []).join("\n")])) as Record<string, string>, [value]);
  const [t, setT] = useState(init);
  useEffect(() => setT(init), [init]);
  const s = useSave(pid, sid, fieldKey);
  const dirty = Q.some((q) => t[q] !== init[q]);
  const labels = block.quadrants ?? ["左上", "右上", "左下", "右下"];
  const ax = block.axes;
  return (
    <div>
      {ax?.x?.label || ax?.x?.low ? (
        <div className="mb-1 grid grid-cols-2 pl-6 text-center text-[10.5px] font-medium text-zinc-500"><span>{ax.x.low}</span><span>{ax.x.high}</span></div>
      ) : null}
      <div className="flex">
        {ax?.y?.label || ax?.y?.low ? (
          <div className="flex w-6 flex-col justify-around text-[10.5px] font-medium text-zinc-500 [writing-mode:vertical-rl]"><span>{ax.y.high}</span><span>{ax.y.low}</span></div>
        ) : null}
        <div className="grid flex-1 grid-cols-2 gap-px overflow-hidden rounded-lg border border-zinc-200 bg-zinc-200">
          {Q.map((q, i) => (
            <div key={q} className={`p-2.5 ${QTONE[i]}`}>
              <div className="mb-1 text-[11.5px] font-semibold text-zinc-700">{labels[i]}</div>
              {readOnly ? (
                <ul className="space-y-0.5 text-[12.5px]">{(value?.[q] ?? []).map((x, j) => <li key={j}>・{x}</li>)}{!(value?.[q] ?? []).length && <li className="text-zinc-400">（未記入）</li>}</ul>
              ) : (
                <textarea className="min-h-[88px] w-full resize-y rounded-md border border-transparent bg-white/60 px-2 py-1 text-[12.5px] outline-none focus:border-brand-400 focus:bg-white"
                  value={t[q]} aria-label={`${block.label}：${labels[i]}`} placeholder="1行に1つずつ" onChange={(e) => { setT({ ...t, [q]: e.target.value }); s.setMsg(null); }} />
              )}
            </div>
          ))}
        </div>
      </div>
      {!readOnly && <SaveBar dirty={dirty} pending={s.pending} msg={s.msg} onSave={() => s.save(Object.fromEntries(Q.map((q) => [q, t[q].split("\n").map((x) => x.trim()).filter(Boolean)])) as MatrixValue)} />}
    </div>
  );
}

// ポジショニング図：2つの軸（0〜100）。点はドラッグで動かせる。★は自社
export function PositioningBlock({ pid, sid, fieldKey, block, value, readOnly }: P<PositioningValue>) {
  const [items, setItems] = useState(value?.items ?? []);
  useEffect(() => setItems(value?.items ?? []), [value]);
  const [drag, setDrag] = useState<number | null>(null);
  const s = useSave(pid, sid, fieldKey);
  const dirty = JSON.stringify(items) !== JSON.stringify(value?.items ?? []);
  const ax: { x: Axis; y: Axis } = block.axes ?? { x: { label: "横軸", low: "低", high: "高" }, y: { label: "縦軸", low: "低", high: "高" } };
  const W = 520, H = 340, PAD = 34;
  const toPx = (x: number, y: number) => [PAD + (x / 100) * (W - PAD * 2), H - PAD - (y / 100) * (H - PAD * 2)];
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag === null || readOnly) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.round(Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width * W - PAD) / (W - PAD * 2) * 100)));
    const y = Math.round(Math.max(0, Math.min(100, (H - PAD - (e.clientY - r.top) / r.height * H) / (H - PAD * 2) * 100)));
    setItems((xs) => xs.map((it, i) => (i === drag ? { ...it, x, y } : it)));
  };
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-none select-none rounded-lg border border-zinc-200 bg-white" onPointerMove={onMove} onPointerUp={() => setDrag(null)} onPointerLeave={() => setDrag(null)} role="img" aria-label={block.label}>
        <line x1={W / 2} y1={PAD} x2={W / 2} y2={H - PAD} stroke="#e4e4e7" />
        <line x1={PAD} y1={H / 2} x2={W - PAD} y2={H / 2} stroke="#e4e4e7" />
        <rect x={PAD} y={PAD} width={W - PAD * 2} height={H - PAD * 2} fill="none" stroke="#e4e4e7" />
        <text x={PAD} y={H - 10} fontSize="11" fill="#71717a">{ax.x.low}</text>
        <text x={W - PAD} y={H - 10} fontSize="11" fill="#71717a" textAnchor="end">{ax.x.high}</text>
        <text x={W / 2} y={H - 10} fontSize="11" fill="#3f3f46" textAnchor="middle" fontWeight="600">{ax.x.label}</text>
        <text x={8} y={H - PAD} fontSize="11" fill="#71717a">{ax.y.low}</text>
        <text x={8} y={PAD + 4} fontSize="11" fill="#71717a">{ax.y.high}</text>
        <text x={12} y={H / 2} fontSize="11" fill="#3f3f46" fontWeight="600" transform={`rotate(-90 12 ${H / 2})`} textAnchor="middle">{ax.y.label}</text>
        {items.map((it, i) => {
          const [cx, cy] = toPx(it.x, it.y);
          return (
            <g key={i} onPointerDown={() => !readOnly && setDrag(i)} style={{ cursor: readOnly ? "default" : "grab" }}>
              <circle cx={cx} cy={cy} r={it.self ? 8 : 6} fill={it.self ? "#4f46e5" : "#a1a1aa"} stroke="#fff" strokeWidth="2" />
              <text x={cx + 10} y={cy + 4} fontSize="11.5" fill="#18181b" fontWeight={it.self ? 700 : 400}>{it.self ? "★" : ""}{it.name}</text>
            </g>
          );
        })}
      </svg>
      <div className="space-y-1.5">
        {items.map((it, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[12px]">
            <button disabled={readOnly} onClick={() => setItems(items.map((x, j) => (j === i ? { ...x, self: !x.self } : x)))} aria-label="自社にする" className={it.self ? "text-brand-600" : "text-zinc-300"}><Star size={13} fill={it.self ? "currentColor" : "none"} /></button>
            <input className="input h-7 flex-1 text-[12px]" value={it.name} disabled={readOnly} aria-label="名前" onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <span className="w-14 text-right text-[10.5px] tabular-nums text-zinc-400">{Math.round(it.x)}, {Math.round(it.y)}</span>
            {!readOnly && <button onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label="消す" className="text-zinc-400 hover:text-rose-600"><Trash2 size={12} /></button>}
          </div>
        ))}
        {!readOnly && <button className="btn-secondary btn-sm" onClick={() => setItems([...items, { name: `項目${items.length + 1}`, x: 50, y: 50 }])}><Plus size={12} />点を足す</button>}
        {!readOnly && <SaveBar dirty={dirty} pending={s.pending} msg={s.msg} onSave={() => s.save({ items })} />}
      </div>
    </div>
  );
}

type DNode = Node<{ label: string; kind?: string; onRename?: (id: string, label: string) => void; readOnly?: boolean }>;
function BoxNode({ id, data }: NodeProps<DNode>) {
  return (
    <div className="min-w-[110px] rounded-lg border border-zinc-300 bg-white px-3 py-2 text-center text-[12px] shadow-card"
      onDoubleClick={() => { if (data.readOnly) return; const t = prompt("名前", data.label); if (t && t.trim()) data.onRename?.(id, t.trim()); }}>
      <Handle type="target" position={Position.Left} />
      {data.kind && <div className="text-[9.5px] text-zinc-400">{data.kind}</div>}
      <div className="font-medium">{data.label}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const NODE_TYPES = { box: BoxNode };

// 図（ノードと線）：関係者マップ・エコシステムなど。ダブルクリックで名前、線を引いて関係、線を押すとラベル
export function DiagramBlock({ pid, sid, fieldKey, block, value, readOnly }: P<DiagramValue>) {
  const s = useSave(pid, sid, fieldKey);
  const rename = useCallback((id: string, label: string) => setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, label } } : n))), []);
  const toNodes = (v?: DiagramValue): DNode[] => (v?.nodes ?? []).map((n) => ({ id: n.id, type: "box", position: { x: n.x, y: n.y }, data: { label: n.label, kind: n.kind, onRename: rename, readOnly } }));
  const toEdges = (v?: DiagramValue): Edge[] => (v?.edges ?? []).map((e, i) => ({ id: `e${i}-${e.source}-${e.target}`, source: e.source, target: e.target, label: e.label, markerEnd: { type: MarkerType.ArrowClosed } }));
  const [nodes, setNodes, onNodesChange] = useNodesState<DNode>(toNodes(value));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(toEdges(value));
  const [kind, setKind] = useState(block.node_kinds?.[0] ?? "");
  const current = (): DiagramValue => ({
    nodes: nodes.map((n) => ({ id: n.id, label: n.data.label, kind: n.data.kind, x: Math.round(n.position.x), y: Math.round(n.position.y) })),
    edges: edges.map((e) => ({ source: e.source, target: e.target, label: String(e.label ?? "") })),
  });
  const dirty = JSON.stringify(current()) !== JSON.stringify({ nodes: value?.nodes ?? [], edges: (value?.edges ?? []).map((e) => ({ ...e, label: e.label ?? "" })) });
  return (
    <div>
      <div className="h-[340px] rounded-lg border border-zinc-200 bg-white" aria-label={block.label}>
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} onNodesChange={readOnly ? undefined : onNodesChange} onEdgesChange={readOnly ? undefined : onEdgesChange}
          onConnect={(c: Connection) => !readOnly && setEdges((es) => addEdge({ ...c, markerEnd: { type: MarkerType.ArrowClosed } }, es))}
          onEdgeClick={(_, e) => { if (readOnly) return; const t = prompt("線のラベル（お金・モノ・情報など）", String(e.label ?? "")); if (t !== null) setEdges((es) => es.map((x) => (x.id === e.id ? { ...x, label: t } : x))); }}
          nodesDraggable={!readOnly} nodesConnectable={!readOnly} fitView proOptions={{ hideAttribution: true }}>
          <Background gap={16} color="#f4f4f5" /><Controls showInteractive={false} />
        </ReactFlow>
      </div>
      {!readOnly && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {(block.node_kinds?.length ?? 0) > 0 && (
            <select className="input h-8 w-auto text-[12px]" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="ノードの種類">
              {block.node_kinds!.map((k) => <option key={k}>{k}</option>)}
            </select>
          )}
          <button className="btn-secondary btn-sm" onClick={() => {
            const id = `n${Date.now().toString(36)}`;
            setNodes((ns) => [...ns, { id, type: "box", position: { x: 60 + (ns.length % 4) * 170, y: 40 + Math.floor(ns.length / 4) * 110 }, data: { label: kind || "新しい要素", kind, onRename: rename, readOnly } }]);
          }}><Plus size={12} />要素を足す</button>
          <span className="text-[11px] text-zinc-400">ダブルクリックで名前・端から引いて線・線を押してラベル・選んで Delete で消す</span>
          <span className="ml-auto" />
          <SaveBar dirty={dirty} pending={s.pending} msg={s.msg} onSave={() => s.save(current())} />
        </div>
      )}
    </div>
  );
}
