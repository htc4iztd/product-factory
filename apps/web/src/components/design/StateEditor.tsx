"use client";
import "@xyflow/react/dist/style.css";
import { useMemo, useState } from "react";
import {
  Background, ConnectionMode, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider,
  type Connection, type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import { Plus, Trash2 } from "lucide-react";
import type { SmState, SmTransition, StateMachine } from "@/lib/agent";
import { Expandable, MiniTable, SaveBar, layered, uid, useEditable } from "./kit";

const KIND = [{ value: "initial", label: "開始" }, { value: "normal", label: "途中" }, { value: "final", label: "終了" }];
type SData = { s: SmState; selected: boolean };

function StateNode({ data }: NodeProps<Node<SData>>) {
  const { s, selected } = data;
  const h = "!h-2 !w-2 !border-zinc-400 !bg-white";
  const base = s.kind === "initial" ? "border-emerald-400 bg-emerald-50 text-emerald-900"
    : s.kind === "final" ? "border-zinc-700 bg-zinc-100 text-zinc-900 outline outline-2 outline-offset-2 outline-zinc-700" : "border-zinc-300 bg-white text-zinc-800";
  return (
    <div className={`relative flex min-h-12 w-40 flex-col items-center justify-center rounded-2xl border px-3 py-2 text-center text-[12px] font-medium shadow-card ${base} ${selected ? "ring-4 ring-brand-100" : ""}`}
      title={s.note || undefined}>
      {s.kind === "initial" && <span className="absolute -left-5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-zinc-800" aria-hidden />}
      <span>{s.name}</span>
      {s.note && <span className="mt-0.5 line-clamp-2 text-[10px] font-normal text-zinc-500">{s.note}</span>}
      <Handle type="source" position={Position.Left} id="l" className={h} />
      <Handle type="source" position={Position.Right} id="r" className={h} />
      <Handle type="source" position={Position.Top} id="t" className={h} />
      <Handle type="source" position={Position.Bottom} id="b" className={h} />
    </div>
  );
}
const nodeTypes = { state: StateNode };
const label = (t: SmTransition) => t.event + (t.guard ? ` [${t.guard}]` : "") + (t.action ? ` / ${t.action}` : "");

function Editor({ pid, sid, fieldKey, value, readOnly }: { pid: string; sid: string; fieldKey: string; value: StateMachine[]; readOnly: boolean }) {
  const ed = useEditable<StateMachine[]>(pid, sid, fieldKey, value);
  const [idx, setIdx] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  const m = ed.v[Math.min(idx, ed.v.length - 1)];
  const auto = useMemo(() => (m ? layered(m.states.map((s) => s.id), m.transitions, 330, 120) : {}), [m]);
  const change = (fn: (x: StateMachine) => StateMachine) => ed.change((all) => all.map((x, i) => (i === idx ? fn(x) : x)));

  const nodes: Node<SData>[] = (m?.states ?? []).map((s) => ({
    id: s.id, type: "state", data: { s, selected: sel === s.id },
    position: { x: s.x ?? auto[s.id]?.x ?? 0, y: s.y ?? auto[s.id]?.y ?? 0 }, draggable: !readOnly,
  }));
  const edges: Edge[] = (m?.transitions ?? []).map((t) => ({
    id: t.id, source: t.source, target: t.target, type: t.source === t.target ? "default" : "smoothstep", label: label(t) || undefined,
    markerEnd: { type: MarkerType.ArrowClosed, color: "#71717a" }, style: { stroke: sel === t.id ? "#6366f1" : "#71717a", strokeWidth: 1.5 },
    labelStyle: { fontSize: 10, fill: "#3f3f46" }, labelBgStyle: { fill: "#fff" }, labelBgPadding: [4, 2] as [number, number],
  }));
  const connect = (c: Connection) => {
    if (!c.source || !c.target) return;
    const id = uid("T");
    change((x) => ({ ...x, transitions: [...x.transitions, { id, source: c.source!, target: c.target!, event: "", guard: "", action: "" }] }));
    setSel(id);
  };
  const opts = (m?.states ?? []).map((s) => ({ value: s.id, label: s.name || s.id }));

  return (
    <Expandable toolbar={<>
      {ed.v.map((x, i) => (
        <button key={i} onClick={() => { setIdx(i); setSel(null); }}
          className={`rounded-md px-2.5 py-1 text-[12px] font-medium ${i === idx ? "bg-zinc-900 text-white" : "border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"}`}>
          {x.target || "（対象なし）"}
        </button>
      ))}
      {!readOnly && (
        <button className="btn-ghost btn-sm" onClick={() => {
          const t = prompt("状態を持つもの（例：注文・申込）");
          if (!t) return;
          ed.change((all) => [...all, { target: t, states: [{ id: uid("S"), name: "初期", kind: "initial", note: "" }], transitions: [] }]);
          setIdx(ed.v.length);
        }}><Plus size={12} />対象を追加</button>
      )}
    </>}>
      {(full) => (<>{!m ? (
        <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-zinc-300 text-[13px] text-zinc-500">
          状態を持つもの（注文・申込など）を追加するか、AI に下書きを頼んでください
        </div>
      ) : (<>
        <div className={`overflow-hidden rounded-xl border border-zinc-200 bg-white ${full ? "h-[50vh]" : "h-[380px]"}`}>
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} connectionMode={ConnectionMode.Loose}
            nodesConnectable={!readOnly} minZoom={0.2} proOptions={{ hideAttribution: true }} fitView deleteKeyCode={null}
            onNodeClick={(_, n) => setSel(n.id)} onEdgeClick={(_, e) => setSel(e.id)} onPaneClick={() => setSel(null)} onConnect={connect}
            onNodeDragStop={(_, n) => change((x) => ({ ...x, states: x.states.map((s) => (s.id === n.id ? { ...s, x: Math.round(n.position.x), y: Math.round(n.position.y) } : s)) }))}>
            <Background gap={20} color="#f4f4f5" />
            <Controls showInteractive={false} position="bottom-right" />
          </ReactFlow>
        </div>
        {!readOnly && (
          <label className="flex items-center gap-2 text-[12px]"><span className="text-zinc-500">対象</span>
            <input className="input h-7 w-56 py-0 text-[12px]" value={m.target} aria-label="状態を持つもの" onChange={(e) => change((x) => ({ ...x, target: e.target.value }))} />
            <button className="btn-ghost btn-sm text-zinc-400 hover:text-rose-600" onClick={() => { if (confirm(`「${m.target}」の状態遷移を削除しますか？`)) { ed.change((all) => all.filter((_, i) => i !== idx)); setIdx(0); } }}>
              <Trash2 size={11} />この対象を削除
            </button>
          </label>
        )}
        <div className="grid gap-3 xl:grid-cols-[2fr_3fr]">
          <div>
            <div className="mb-1 text-[12px] font-medium text-zinc-600">状態</div>
            <MiniTable<SmState> readOnly={readOnly} rows={m.states} addLabel="状態を追加"
              active={m.states.findIndex((s) => s.id === sel)} onRowClick={(i) => setSel(m.states[i].id)}
              blank={() => ({ id: uid("S"), name: "", kind: "normal", note: "" })}
              onChange={(states) => change((x) => ({ ...x, states, transitions: x.transitions.filter((t) => states.some((s) => s.id === t.source) && states.some((s) => s.id === t.target)) }))}
              cols={[{ key: "name", label: "状態" }, { key: "kind", label: "種類", kind: "select", options: KIND, width: "5.5rem" }, { key: "note", label: "説明" }]} />
          </div>
          <div>
            <div className="mb-1 text-[12px] font-medium text-zinc-600">遷移（図の縁の点から別の状態へドラッグしても足せます）</div>
            <MiniTable<SmTransition> readOnly={readOnly} rows={m.transitions} addLabel="遷移を追加"
              active={m.transitions.findIndex((t) => t.id === sel)} onRowClick={(i) => setSel(m.transitions[i].id)}
              blank={() => ({ id: uid("T"), source: m.states[0]?.id ?? "", target: m.states[1]?.id ?? m.states[0]?.id ?? "", event: "", guard: "", action: "" })}
              onChange={(transitions) => change((x) => ({ ...x, transitions }))}
              cols={[{ key: "source", label: "遷移元", kind: "select", options: opts }, { key: "target", label: "遷移先", kind: "select", options: opts },
                { key: "event", label: "イベント" }, { key: "guard", label: "条件" }, { key: "action", label: "処理" }]} />
          </div>
        </div>
      </>)}
      {!readOnly && <div className="flex justify-end"><SaveBar e={ed} label="状態遷移を保存" /></div>}
      </>)}
    </Expandable>
  );
}

const EMPTY: StateMachine[] = [];

export function StateEditor(props: { pid: string; sid: string; fieldKey: string; value: StateMachine[] | undefined; readOnly: boolean }) {
  return <ReactFlowProvider><Editor {...props} value={props.value ?? EMPTY} /></ReactFlowProvider>;
}
