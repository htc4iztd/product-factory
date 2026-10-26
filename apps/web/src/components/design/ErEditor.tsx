"use client";
import "@xyflow/react/dist/style.css";
import { useMemo, useState } from "react";
import {
  Background, ConnectionMode, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider,
  type Connection, type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import { KeyRound, Link2, Plus, Trash2 } from "lucide-react";
import type { ErAttr, ErEntity, ErModel, ErRelation } from "@/lib/agent";
import { Expandable, MiniTable, SaveBar, layered, uid, useEditable } from "./kit";

const CARDS: ErRelation["card"][] = ["1:1", "1:N", "N:1", "N:M"];
type EData = { e: ErEntity; selected: boolean };

function EntityNode({ data }: NodeProps<Node<EData>>) {
  const { e, selected } = data;
  const h = "!h-2 !w-2 !border-zinc-400 !bg-white";
  return (
    <div className={`w-56 overflow-hidden rounded-lg border bg-white text-[11px] shadow-card ${selected ? "border-brand-500 ring-4 ring-brand-100" : "border-zinc-300"}`}>
      <div className="border-b border-zinc-200 bg-zinc-800 px-2 py-1.5 text-white">
        <div className="truncate font-semibold">{e.name || "（名前なし）"}</div>
        {e.physical && <div className="truncate font-mono text-[10px] text-zinc-300">{e.physical}</div>}
      </div>
      <div className="divide-y divide-zinc-100">
        {e.attrs.length === 0 && <div className="px-2 py-1 text-zinc-400">属性なし</div>}
        {e.attrs.slice(0, 14).map((a, i) => (
          <div key={i} className={`flex items-center gap-1 px-2 py-0.5 ${a.pk ? "bg-amber-50" : ""}`}>
            <span className="w-7 shrink-0 text-[9px] font-bold">
              {a.pk ? <span className="text-amber-600">PK</span> : a.fk ? <span className="text-sky-600">FK</span> : ""}
            </span>
            <span className={`truncate ${a.required ? "font-medium" : "text-zinc-600"}`}>{a.name || a.physical}</span>
            <span className="ml-auto shrink-0 font-mono text-[9px] text-zinc-400">{a.type}</span>
          </div>
        ))}
        {e.attrs.length > 14 && <div className="px-2 py-0.5 text-zinc-400">ほか {e.attrs.length - 14} 件</div>}
      </div>
      <Handle type="source" position={Position.Left} id="l" className={h} />
      <Handle type="source" position={Position.Right} id="r" className={h} />
      <Handle type="source" position={Position.Top} id="t" className={h} />
      <Handle type="source" position={Position.Bottom} id="b" className={h} />
    </div>
  );
}
const nodeTypes = { entity: EntityNode };

function Editor({ pid, sid, fieldKey, value, readOnly }: { pid: string; sid: string; fieldKey: string; value: ErModel; readOnly: boolean }) {
  const ed = useEditable<ErModel>(pid, sid, fieldKey, value);
  const m = ed.v;
  const [sel, setSel] = useState<{ kind: "entity" | "rel"; id: string } | null>(null);
  const auto = useMemo(() => layered(m.entities.map((e) => e.id), m.relations, 340, 280), [m.entities, m.relations]);
  const byId = Object.fromEntries(m.entities.map((e) => [e.id, e]));

  const nodes: Node<EData>[] = m.entities.map((e) => ({
    id: e.id, type: "entity", data: { e, selected: sel?.kind === "entity" && sel.id === e.id },
    position: { x: e.x ?? auto[e.id]?.x ?? 0, y: e.y ?? auto[e.id]?.y ?? 0 }, draggable: !readOnly,
  }));
  const edges: Edge[] = m.relations.map((r) => ({
    id: r.id, source: r.source, target: r.target, type: "smoothstep",
    label: `${r.card}${r.label ? `  ${r.label}` : ""}`,
    markerEnd: r.card.endsWith("N") || r.card.endsWith("M") ? { type: MarkerType.ArrowClosed, color: "#71717a" } : undefined,
    style: { stroke: sel?.kind === "rel" && sel.id === r.id ? "#6366f1" : "#71717a", strokeWidth: 1.5 },
    labelStyle: { fontSize: 11, fontWeight: 600, fill: "#3f3f46" }, labelBgStyle: { fill: "#fff" }, labelBgPadding: [4, 2] as [number, number],
  }));

  const ent = sel?.kind === "entity" ? byId[sel.id] : undefined;
  const rel = sel?.kind === "rel" ? m.relations.find((r) => r.id === sel.id) : undefined;
  const patchEnt = (id: string, p: Partial<ErEntity>) => ed.change((x) => ({ ...x, entities: x.entities.map((e) => (e.id === id ? { ...e, ...p } : e)) }));
  const patchRel = (id: string, p: Partial<ErRelation>) => ed.change((x) => ({ ...x, relations: x.relations.map((r) => (r.id === id ? { ...r, ...p } : r)) }));
  const addEntity = () => {
    const id = uid("E");
    const maxX = Math.max(0, ...nodes.map((n) => n.position.x + 300));
    ed.change((x) => ({ ...x, entities: [...x.entities, { id, name: "新しいエンティティ", physical: "", note: "", x: maxX, y: 0,
      attrs: [{ name: "ID", physical: "id", type: "bigint", pk: true, fk: "", required: true, note: "" }] }] }));
    setSel({ kind: "entity", id });
  };
  const connect = (c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return;
    const id = uid("R");
    ed.change((x) => ({ ...x, relations: [...x.relations, { id, source: c.source!, target: c.target!, card: "1:N", label: "" }] }));
    setSel({ kind: "rel", id });
  };
  const blankAttr = (): ErAttr => ({ name: "", physical: "", type: "", pk: false, fk: "", required: false, note: "" });

  return (
    <Expandable toolbar={<>
      <span className="text-[12px] text-zinc-500">エンティティ {m.entities.length}・リレーション {m.relations.length}</span>
      {!readOnly && <button onClick={addEntity} className="btn-secondary btn-sm"><Plus size={12} />エンティティを追加</button>}
    </>}>
      {(full) => (<>
        {m.entities.length === 0 ? (
          <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-zinc-300 text-[13px] text-zinc-500">
            エンティティを追加するか、AI に下書きを頼んでください
          </div>
        ) : (
          <div className={`overflow-hidden rounded-xl border border-zinc-200 bg-white ${full ? "h-[62vh]" : "h-[480px]"}`}>
            <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} connectionMode={ConnectionMode.Loose}
              nodesConnectable={!readOnly} minZoom={0.2} proOptions={{ hideAttribution: true }} fitView
              onNodeClick={(_, n) => setSel({ kind: "entity", id: n.id })} onEdgeClick={(_, e) => setSel({ kind: "rel", id: e.id })}
              onPaneClick={() => setSel(null)} onConnect={connect} deleteKeyCode={null}
              onNodeDragStop={(_, n) => patchEnt(n.id, { x: Math.round(n.position.x), y: Math.round(n.position.y) })}>
              <Background gap={20} color="#f4f4f5" />
              <Controls showInteractive={false} position="bottom-right" />
            </ReactFlow>
          </div>
        )}
        {ent && (
          <div className="space-y-2 rounded-xl border border-brand-200 bg-brand-50/30 p-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="block"><span className="label">論理名</span>
                <input className="input h-8" value={ent.name} readOnly={readOnly} aria-label="エンティティの論理名" onChange={(e) => patchEnt(ent.id, { name: e.target.value })} /></label>
              <label className="block"><span className="label">物理名</span>
                <input className="input h-8 font-mono" value={ent.physical} readOnly={readOnly} aria-label="エンティティの物理名" onChange={(e) => patchEnt(ent.id, { physical: e.target.value })} /></label>
              <label className="block min-w-[14rem] flex-1"><span className="label">説明</span>
                <input className="input h-8" value={ent.note} readOnly={readOnly} onChange={(e) => patchEnt(ent.id, { note: e.target.value })} /></label>
              {!readOnly && (
                <button className="btn-danger btn-sm" onClick={() => { ed.change((x) => ({ entities: x.entities.filter((e) => e.id !== ent.id), relations: x.relations.filter((r) => r.source !== ent.id && r.target !== ent.id) })); setSel(null); }}>
                  <Trash2 size={11} />エンティティを削除
                </button>
              )}
            </div>
            <MiniTable<ErAttr> readOnly={readOnly} rows={ent.attrs} blank={blankAttr} addLabel="属性を追加"
              onChange={(attrs) => patchEnt(ent.id, { attrs })}
              cols={[
                { key: "name", label: "属性（論理名）" }, { key: "physical", label: "物理名" }, { key: "type", label: "型", width: "7rem" },
                { key: "pk", label: "PK", kind: "check", width: "3rem" }, { key: "required", label: "必須", kind: "check", width: "3rem" },
                { key: "fk", label: "FK（参照先.属性）", placeholder: "例：利用者.利用者ID" },
                { key: "note", label: "説明" },
              ]} />
          </div>
        )}
        {rel && (
          <div className="flex flex-wrap items-end gap-2 rounded-xl border border-brand-200 bg-brand-50/30 p-3 text-[12px]">
            <Link2 size={14} className="mb-2 text-brand-600" />
            <span className="mb-1.5 font-medium">{byId[rel.source]?.name} → {byId[rel.target]?.name}</span>
            <label className="block"><span className="label">多重度</span>
              <select className="input h-8" value={rel.card} disabled={readOnly} aria-label="多重度" onChange={(e) => patchRel(rel.id, { card: e.target.value as ErRelation["card"] })}>
                {CARDS.map((c) => <option key={c}>{c}</option>)}
              </select></label>
            <label className="block min-w-[12rem] flex-1"><span className="label">関係の名前</span>
              <input className="input h-8" value={rel.label} readOnly={readOnly} aria-label="関係の名前" onChange={(e) => patchRel(rel.id, { label: e.target.value })} /></label>
            {!readOnly && <button className="btn-danger btn-sm" onClick={() => { ed.change((x) => ({ ...x, relations: x.relations.filter((r) => r.id !== rel.id) })); setSel(null); }}><Trash2 size={11} />削除</button>}
          </div>
        )}
        {!ent && !rel && m.entities.length > 0 && (
          <p className="flex items-center gap-1 text-[11px] text-zinc-500">
            <KeyRound size={11} />エンティティを押すと属性（PK・FK・型）を編集できます。縁の点から別のエンティティへドラッグするとリレーションを引けます。
          </p>
        )}
        {!readOnly && <div className="flex justify-end"><SaveBar e={ed} label="データモデルを保存" /></div>}
      </>)}
    </Expandable>
  );
}

const EMPTY: ErModel = { entities: [], relations: [] };

export function ErEditor(props: { pid: string; sid: string; fieldKey: string; value: ErModel | undefined; readOnly: boolean }) {
  return <ReactFlowProvider><Editor {...props} value={props.value ?? EMPTY} /></ReactFlowProvider>;
}
