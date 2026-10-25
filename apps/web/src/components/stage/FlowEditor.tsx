"use client";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  Background, ConnectionMode, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useReactFlow,
  type Connection, type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import { ArrowDown, ArrowUp, Maximize2, Minimize2, Plus, RotateCcw, Save, Server, Trash2, X } from "lucide-react";
import type { Flow, FlowNode } from "@/lib/agent";
import { setField } from "@/app/(app)/p/[id]/s/[stage]/actions";

const LANE_H = 130, LABEL_W = 110;
const TYPES: Record<FlowNode["type"], string> = { start: "開始", task: "作業", decision: "判断", system: "システム処理", end: "終了" };
const SIZE: Record<FlowNode["type"], { w: number; h: number }> = {
  start: { w: 120, h: 44 }, end: { w: 120, h: 44 }, task: { w: 160, h: 64 }, system: { w: 160, h: 64 }, decision: { w: 130, h: 96 },
};
let seq = 0;
const uid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

type NData = { node: FlowNode; selected: boolean };
type LData = { label: string; width: number; index: number };

function Handles() {
  const cls = "!h-2 !w-2 !border-zinc-400 !bg-white";
  return (<>
    <Handle type="source" position={Position.Left} id="l" className={cls} />
    <Handle type="source" position={Position.Right} id="r" className={cls} />
    <Handle type="source" position={Position.Top} id="t" className={cls} />
    <Handle type="source" position={Position.Bottom} id="b" className={cls} />
  </>);
}

function StepNode({ data }: NodeProps<Node<NData>>) {
  const { node, selected } = data;
  const s = SIZE[node.type];
  const ring = selected ? "ring-4 ring-brand-100 border-brand-500" : "";
  const text = node.label || TYPES[node.type];
  if (node.type === "decision") {
    return (
      <div style={{ width: s.w, height: s.h }} className="relative">
        <svg className="absolute inset-0" width={s.w} height={s.h} viewBox={`0 0 ${s.w} ${s.h}`} aria-hidden>
          <polygon points={`${s.w / 2},1 ${s.w - 1},${s.h / 2} ${s.w / 2},${s.h - 1} 1,${s.h / 2}`} fill="#fffbeb"
            stroke={selected ? "#6366f1" : "#f59e0b"} strokeWidth={selected ? 2.5 : 1.5} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-[11px] font-medium leading-tight text-amber-900">{text}</div>
        <Handles />
      </div>
    );
  }
  const base = node.type === "start" ? "rounded-full border-emerald-300 bg-emerald-50 text-emerald-800"
    : node.type === "end" ? "rounded-full border-zinc-700 bg-zinc-800 text-white"
    : node.type === "system" ? "rounded-md border-sky-300 bg-sky-50 text-sky-900"
    : "rounded-lg border-zinc-300 bg-white text-zinc-800";
  return (
    <div style={{ width: s.w, height: s.h }} className={`flex items-center justify-center gap-1 border px-2 text-center text-[11px] font-medium leading-tight shadow-card ${base} ${ring}`}>
      {node.type === "system" && <Server size={11} className="shrink-0" />}<span className="line-clamp-3">{text}</span>
      <Handles />
    </div>
  );
}

function LaneNode({ data }: NodeProps<Node<LData>>) {
  return (
    <div style={{ width: data.width, height: LANE_H }} className={`flex border-b border-zinc-200 ${data.index % 2 ? "bg-zinc-50/80" : "bg-white"}`}>
      <div style={{ width: LABEL_W }} className="flex shrink-0 items-center justify-center border-r border-zinc-200 bg-zinc-100/80 px-2 text-center text-[11px] font-semibold text-zinc-600">
        {data.label}
      </div>
    </div>
  );
}
const nodeTypes = { step: StepNode, lane: LaneNode };

function Editor({ pid, sid, value, businesses, readOnly }: { pid: string; sid: string; value: Flow[]; businesses: string[]; readOnly: boolean }) {
  const initial = useMemo(() => value.map((f) => ({ ...f, nodes: f.nodes.map((n) => ({ ...n })), edges: f.edges.map((e) => ({ ...e })) })), [value]);
  const [flows, setFlows] = useState<Flow[]>(initial);
  const [idx, setIdx] = useState(0);
  const [sel, setSel] = useState<{ kind: "node" | "edge"; id: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [full, setFull] = useState(false);
  const rf = useReactFlow();
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFull(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  useEffect(() => { setFlows(initial); setDirty(false); setSel(null); }, [initial]);
  useEffect(() => { const t = setTimeout(() => rf.fitView({ padding: 0.08, duration: 200 }), 60); return () => clearTimeout(t); }, [idx, flows.length, full, rf]);

  const flow = flows[Math.min(idx, flows.length - 1)];
  const change = (fn: (f: Flow) => Flow) => { setFlows((fs) => fs.map((f, i) => (i === idx ? fn(f) : f))); setDirty(true); setError(null); };

  const width = Math.max(900, LABEL_W + Math.max(0, ...((flow?.nodes ?? []).map((n) => n.x + SIZE[n.type].w))) + 160);
  const nodes: Node[] = flow ? [
    ...flow.lanes.map((l, i): Node<LData> => ({ id: `lane-${i}`, type: "lane", position: { x: 0, y: i * LANE_H }, data: { label: l, width, index: i },
      draggable: false, selectable: false, connectable: false, zIndex: -1 })),
    ...flow.nodes.map((n): Node<NData> => ({ id: n.id, type: "step", data: { node: n, selected: sel?.kind === "node" && sel.id === n.id },
      position: { x: LABEL_W + n.x, y: n.lane * LANE_H + (LANE_H - SIZE[n.type].h) / 2 }, draggable: !readOnly })),
  ] : [];
  const edges: Edge[] = (flow?.edges ?? []).map((e) => ({
    id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? "r", targetHandle: e.targetHandle ?? "l",
    type: "smoothstep", label: e.label || undefined, markerEnd: { type: MarkerType.ArrowClosed, color: "#71717a" },
    style: { stroke: sel?.kind === "edge" && sel.id === e.id ? "#6366f1" : "#71717a", strokeWidth: 1.5 },
    labelStyle: { fontSize: 11, fontWeight: 600, fill: "#3f3f46" }, labelBgStyle: { fill: "#fff" }, labelBgPadding: [4, 2] as [number, number],
  }));

  const node = sel?.kind === "node" ? flow?.nodes.find((n) => n.id === sel.id) : undefined;
  const edge = sel?.kind === "edge" ? flow?.edges.find((e) => e.id === sel.id) : undefined;
  const patchNode = (p: Partial<FlowNode>) => node && change((f) => ({ ...f, nodes: f.nodes.map((n) => (n.id === node.id ? { ...n, ...p } : n)) }));
  const addNode = (type: FlowNode["type"]) => {
    if (!flow) return;
    const id = uid("n");
    const lane = node?.lane ?? 0;
    const x = Math.max(0, ...flow.nodes.filter((n) => n.lane === lane).map((n) => n.x + SIZE[n.type].w + 40), 20);
    change((f) => ({ ...f, nodes: [...f.nodes, { id, type, label: type === "decision" ? "条件?" : "", lane, x }] }));
    setSel({ kind: "node", id });
  };
  const removeSel = () => {
    if (!sel) return;
    change((f) => sel.kind === "node"
      ? { ...f, nodes: f.nodes.filter((n) => n.id !== sel.id), edges: f.edges.filter((e) => e.source !== sel.id && e.target !== sel.id) }
      : { ...f, edges: f.edges.filter((e) => e.id !== sel.id) });
    setSel(null);
  };
  const connect = (c: Connection) => {
    if (!c.source || !c.target || c.source === c.target || c.source.startsWith("lane-") || c.target.startsWith("lane-")) return;
    change((f) => f.edges.some((e) => e.source === c.source && e.target === c.target) ? f
      : { ...f, edges: [...f.edges, { id: uid("e"), source: c.source!, target: c.target!, label: "", sourceHandle: c.sourceHandle ?? undefined, targetHandle: c.targetHandle ?? undefined }] });
  };
  const moveLane = (i: number, d: number) => change((f) => {
    const j = i + d;
    if (j < 0 || j >= f.lanes.length) return f;
    const lanes = [...f.lanes];
    [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
    return { ...f, lanes, nodes: f.nodes.map((n) => ({ ...n, lane: n.lane === i ? j : n.lane === j ? i : n.lane })) };
  });
  const removeLane = (i: number) => change((f) => f.lanes.length <= 1 ? f
    : { ...f, lanes: f.lanes.filter((_, k) => k !== i), nodes: f.nodes.map((n) => ({ ...n, lane: n.lane === i ? Math.max(0, i - 1) : n.lane > i ? n.lane - 1 : n.lane })) });
  const addFlow = (business: string) => {
    if (!business.trim()) return;
    setFlows((fs) => [...fs, { business: business.trim(), lanes: ["担当者", "システム"], nodes: [{ id: uid("n"), type: "start", label: "開始", lane: 0, x: 20 }], edges: [] }]);
    setIdx(flows.length);
    setDirty(true);
    setSel(null);
  };
  const save = () => {
    if (flows.some((f) => !f.business.trim())) return setError("業務名が空のフローがあります");
    start(async () => {
      const r = await setField(pid, sid, "flows", flows);
      if (r.error) setError(r.error); else setDirty(false);
    });
  };
  const unused = businesses.filter((b) => !flows.some((f) => f.business === b));

  return (
    <div className={full ? "fixed inset-0 z-50 flex flex-col gap-2 bg-zinc-50 p-4" : "space-y-2"}>
      <div className="flex flex-wrap items-center gap-1.5">
        {flows.map((f, i) => (
          <button key={i} onClick={() => { setIdx(i); setSel(null); }}
            className={`rounded-md px-2.5 py-1 text-[12px] font-medium ${i === idx ? "bg-zinc-900 text-white" : "border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"}`}>
            {f.business || "（業務名なし）"}
          </button>
        ))}
        {!readOnly && (
          <select value="" aria-label="フローを追加" className="input h-7 w-auto py-0 text-[12px]"
            onChange={(e) => { if (e.target.value === "__new") { const n = prompt("フローを作る業務の名前"); if (n) addFlow(n); } else addFlow(e.target.value); }}>
            <option value="">＋ フローを追加</option>
            {unused.map((b) => <option key={b} value={b}>{b}</option>)}
            <option value="__new">業務名を入力…</option>
          </select>
        )}
        {flow && (
          <button onClick={() => setFull((v) => !v)} className="btn-secondary btn-sm ml-auto" title={full ? "元に戻す（Esc）" : "全画面で編集"}>
            {full ? <><Minimize2 size={12} />元に戻す</> : <><Maximize2 size={12} />全画面で編集</>}
          </button>
        )}
      </div>
      {!flow ? (
        <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-zinc-300 text-[13px] text-zinc-500">
          業務を選んでフローを追加するか、AIに下書きを頼んでください
        </div>
      ) : (
        <div className={`flex overflow-hidden rounded-xl border border-zinc-200 ${full ? "min-h-0 flex-1" : "h-[560px]"}`}>
          <div className="relative min-w-0 flex-1 bg-white">
            <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} connectionMode={ConnectionMode.Loose}
              nodesConnectable={!readOnly} elementsSelectable={!readOnly} minZoom={0.3} proOptions={{ hideAttribution: true }}
              onNodeClick={(_, n) => !n.id.startsWith("lane-") && setSel({ kind: "node", id: n.id })}
              onEdgeClick={(_, e) => setSel({ kind: "edge", id: e.id })}
              onPaneClick={() => setSel(null)}
              onConnect={connect}
              onNodeDragStop={(_, n) => {
                const fn = flow.nodes.find((x) => x.id === n.id);
                if (!fn) return;
                const lane = Math.min(flow.lanes.length - 1, Math.max(0, Math.floor((n.position.y + SIZE[fn.type].h / 2) / LANE_H)));
                change((f) => ({ ...f, nodes: f.nodes.map((x) => (x.id === n.id ? { ...x, lane, x: Math.max(0, Math.round(n.position.x - LABEL_W)) } : x)) }));
              }}
              onNodesDelete={(ns) => ns.forEach((n) => { setSel({ kind: "node", id: n.id }); })}
              deleteKeyCode={null} fitView>
              <Background gap={20} color="#f4f4f5" />
              <Controls showInteractive={false} position="bottom-right" />
            </ReactFlow>
          </div>
          {!readOnly && (
            <div className="flex w-60 shrink-0 flex-col gap-3 overflow-y-auto border-l border-zinc-200 bg-white p-3 text-[12px]">
              <label className="block"><span className="label">業務名</span>
                <input className="input" value={flow.business} onChange={(e) => change((f) => ({ ...f, business: e.target.value }))} /></label>
              <div>
                <span className="label">レーン（担当）</span>
                <div className="space-y-1">
                  {flow.lanes.map((l, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <input className="input h-7 py-0 text-[12px]" value={l} aria-label={`レーン${i + 1}`}
                        onChange={(e) => change((f) => ({ ...f, lanes: f.lanes.map((x, k) => (k === i ? e.target.value : x)) }))} />
                      <button onClick={() => moveLane(i, -1)} className="btn-ghost btn-sm h-7 w-6 p-0" aria-label="上へ"><ArrowUp size={11} /></button>
                      <button onClick={() => moveLane(i, 1)} className="btn-ghost btn-sm h-7 w-6 p-0" aria-label="下へ"><ArrowDown size={11} /></button>
                      <button onClick={() => removeLane(i)} className="btn-ghost btn-sm h-7 w-6 p-0" aria-label="レーンを削除"><X size={11} /></button>
                    </div>
                  ))}
                  <button onClick={() => change((f) => ({ ...f, lanes: [...f.lanes, `担当${f.lanes.length + 1}`] }))} className="btn-ghost btn-sm"><Plus size={11} />レーンを追加</button>
                </div>
              </div>
              <div>
                <span className="label">部品を追加（{node ? `「${flow.lanes[node.lane]}」レーン` : `「${flow.lanes[0]}」レーン`}に置きます）</span>
                <div className="flex flex-wrap gap-1">
                  {(Object.keys(TYPES) as FlowNode["type"][]).map((t) => (
                    <button key={t} onClick={() => addNode(t)} className="btn-secondary btn-sm">{TYPES[t]}</button>
                  ))}
                </div>
              </div>
              {node && (
                <div className="space-y-2 rounded-lg border border-brand-200 bg-brand-50/40 p-2">
                  <div className="font-semibold">選んだ部品</div>
                  <textarea className="input" rows={2} value={node.label} placeholder={TYPES[node.type]} aria-label="部品の名前"
                    onChange={(e) => patchNode({ label: e.target.value })} />
                  <div className="flex gap-1">
                    <select className="input h-7 py-0 text-[12px]" value={node.type} aria-label="部品の種類" onChange={(e) => patchNode({ type: e.target.value as FlowNode["type"] })}>
                      {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <select className="input h-7 py-0 text-[12px]" value={node.lane} aria-label="レーン" onChange={(e) => patchNode({ lane: Number(e.target.value) })}>
                      {flow.lanes.map((l, i) => <option key={i} value={i}>{l}</option>)}
                    </select>
                  </div>
                  <button onClick={removeSel} className="btn-danger btn-sm"><Trash2 size={11} />削除</button>
                </div>
              )}
              {edge && (
                <div className="space-y-2 rounded-lg border border-brand-200 bg-brand-50/40 p-2">
                  <div className="font-semibold">選んだ矢印</div>
                  <input className="input" value={edge.label} placeholder="ラベル（判断の分岐など）" aria-label="矢印のラベル"
                    onChange={(e) => change((f) => ({ ...f, edges: f.edges.map((x) => (x.id === edge.id ? { ...x, label: e.target.value } : x)) }))} />
                  <div className="flex gap-1">
                    {["はい", "いいえ"].map((l) => (
                      <button key={l} onClick={() => change((f) => ({ ...f, edges: f.edges.map((x) => (x.id === edge.id ? { ...x, label: l } : x)) }))} className="btn-ghost btn-sm">{l}</button>
                    ))}
                    <button onClick={removeSel} className="btn-danger btn-sm ml-auto"><Trash2 size={11} />削除</button>
                  </div>
                </div>
              )}
              {!node && !edge && (
                <p className="text-[11px] leading-5 text-zinc-500">部品はドラッグで動かせます（上下に動かすとレーンが変わります）。部品の縁の点から別の部品へドラッグすると矢印でつなぎます。</p>
              )}
              <div className="mt-auto space-y-2 border-t border-zinc-100 pt-3">
                {error && <p className="text-[11px] text-rose-600">{error}</p>}
                <div className="flex gap-2">
                  <button disabled={!dirty || pending} onClick={save} className="btn-primary btn-sm flex-1"><Save size={12} />{pending ? "保存中…" : "フローを保存"}</button>
                  <button disabled={!dirty || pending} onClick={() => { setFlows(initial); setDirty(false); setSel(null); }} className="btn-ghost btn-sm" aria-label="変更を取り消す"><RotateCcw size={12} /></button>
                </div>
                {dirty && <p className="text-[10px] text-amber-600">保存していない変更があります</p>}
                <button onClick={() => { if (confirm(`「${flow.business}」のフローを削除しますか？`)) { setFlows((fs) => fs.filter((_, i) => i !== idx)); setIdx(0); setDirty(true); setSel(null); } }}
                  className="btn-ghost btn-sm w-full text-zinc-400 hover:text-rose-600"><Trash2 size={11} />このフローを削除</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function FlowEditor(props: { pid: string; sid: string; value: Flow[]; businesses: string[]; readOnly: boolean }) {
  return <ReactFlowProvider><Editor {...props} /></ReactFlowProvider>;
}
