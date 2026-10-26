"use client";
import "@xyflow/react/dist/style.css";
import { useMemo, useState } from "react";
import {
  Background, ConnectionMode, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider,
  type Connection, type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import {
  Bot, Box, Boxes, Cloud, Database, Globe, HardDrive, Layers, MessagesSquare, Monitor, Network, Activity, Server, User, Zap,
} from "lucide-react";
import type { ArchEdge, ArchGraph, ArchNode } from "@/lib/agent";
import { Expandable, MiniTable, SaveBar, uid, useEditable } from "./kit";

export const NODE_KINDS: Record<string, { label: string; icon: typeof Box; color: string }> = {
  user: { label: "利用者", icon: User, color: "#0f766e" },
  client: { label: "端末・ブラウザ", icon: Monitor, color: "#0f766e" },
  edge: { label: "CDN・LB・ゲートウェイ", icon: Globe, color: "#7c3aed" },
  compute: { label: "サーバー・VM", icon: Server, color: "#2563eb" },
  container: { label: "コンテナ", icon: Boxes, color: "#2563eb" },
  function: { label: "関数", icon: Zap, color: "#2563eb" },
  db: { label: "データベース", icon: Database, color: "#b45309" },
  storage: { label: "ストレージ", icon: HardDrive, color: "#b45309" },
  cache: { label: "キャッシュ", icon: Layers, color: "#b45309" },
  queue: { label: "キュー・メッセージ", icon: MessagesSquare, color: "#be185d" },
  ai: { label: "AI・モデル", icon: Bot, color: "#4f46e5" },
  monitoring: { label: "監視・ログ", icon: Activity, color: "#52525b" },
  network: { label: "ネットワーク", icon: Network, color: "#52525b" },
  external: { label: "外部システム", icon: Cloud, color: "#52525b" },
};
const KIND_OPTS = Object.entries(NODE_KINDS).map(([value, k]) => ({ value, label: k.label }));
const W = 170, H = 64, PAD = 28;

type NData = { n: ArchNode; selected: boolean };
type ZData = { label: string; w: number; h: number };

function ResNode({ data }: NodeProps<Node<NData>>) {
  const { n, selected } = data;
  const k = NODE_KINDS[n.kind] ?? NODE_KINDS.compute;
  const Icon = k.icon;
  const h = "!h-2 !w-2 !border-zinc-400 !bg-white";
  return (
    <div style={{ width: W, minHeight: H }} title={n.note || undefined}
      className={`flex items-center gap-2 rounded-lg border bg-white px-2.5 py-2 text-[11px] shadow-card ${selected ? "border-brand-500 ring-4 ring-brand-100" : "border-zinc-300"}`}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md" style={{ background: `${k.color}14`, color: k.color }}><Icon size={16} /></span>
      <span className="min-w-0">
        <span className="line-clamp-2 font-semibold text-zinc-800">{n.label}</span>
        <span className="block truncate text-[10px] text-zinc-500">{k.label}</span>
      </span>
      <Handle type="source" position={Position.Left} id="l" className={h} />
      <Handle type="source" position={Position.Right} id="r" className={h} />
      <Handle type="source" position={Position.Top} id="t" className={h} />
      <Handle type="source" position={Position.Bottom} id="b" className={h} />
    </div>
  );
}

function ZoneNode({ data }: NodeProps<Node<ZData>>) {
  return (
    <div style={{ width: data.w, height: data.h }} className="rounded-2xl border-2 border-dashed border-zinc-300 bg-zinc-50/70">
      <span className="absolute -top-2.5 left-3 rounded bg-white px-1.5 text-[11px] font-semibold text-zinc-500">{data.label}</span>
    </div>
  );
}
const nodeTypes = { res: ResNode, zone: ZoneNode };

// 位置のないノードは、置き場所（ゾーン）ごとに列を作って縦に並べる
function autoPlace(nodes: ArchNode[]) {
  const zones = [...new Set(nodes.map((n) => n.zone))];
  const out: Record<string, { x: number; y: number }> = {};
  zones.forEach((z, zi) => nodes.filter((n) => n.zone === z).forEach((n, i) => { out[n.id] = { x: zi * (W + 120), y: i * (H + 50) }; }));
  return out;
}

function Editor({ pid, sid, fieldKey, value, readOnly }: { pid: string; sid: string; fieldKey: string; value: ArchGraph; readOnly: boolean }) {
  const ed = useEditable<ArchGraph>(pid, sid, fieldKey, value);
  const g = ed.v;
  const [sel, setSel] = useState<string | null>(null);
  const auto = useMemo(() => autoPlace(g.nodes), [g.nodes]);
  const pos = (n: ArchNode) => ({ x: n.x ?? auto[n.id]?.x ?? 0, y: n.y ?? auto[n.id]?.y ?? 0 });

  const zoneNodes: Node<ZData>[] = [...new Set(g.nodes.map((n) => n.zone).filter(Boolean))].map((z) => {
    const ps = g.nodes.filter((n) => n.zone === z).map(pos);
    const x0 = Math.min(...ps.map((p) => p.x)) - PAD, y0 = Math.min(...ps.map((p) => p.y)) - PAD;
    const x1 = Math.max(...ps.map((p) => p.x + W)) + PAD, y1 = Math.max(...ps.map((p) => p.y + H)) + PAD;
    return { id: `zone:${z}`, type: "zone", position: { x: x0, y: y0 }, data: { label: z, w: x1 - x0, h: y1 - y0 },
      draggable: false, selectable: false, connectable: false, zIndex: -1 };
  });
  const nodes: Node[] = [
    ...zoneNodes,
    ...g.nodes.map((n): Node<NData> => ({ id: n.id, type: "res", data: { n, selected: sel === n.id }, position: pos(n), draggable: !readOnly })),
  ];
  const edges: Edge[] = g.edges.map((e) => ({
    id: e.id, source: e.source, target: e.target, type: "smoothstep", label: e.label || undefined,
    markerEnd: { type: MarkerType.ArrowClosed, color: "#71717a" }, style: { stroke: sel === e.id ? "#6366f1" : "#71717a", strokeWidth: 1.5 },
    labelStyle: { fontSize: 10, fill: "#3f3f46" }, labelBgStyle: { fill: "#fff" }, labelBgPadding: [4, 2] as [number, number],
  }));
  const connect = (c: Connection) => {
    if (!c.source || !c.target || c.source === c.target || c.source.startsWith("zone:") || c.target.startsWith("zone:")) return;
    const id = uid("L");
    ed.change((x) => ({ ...x, edges: [...x.edges, { id, source: c.source!, target: c.target!, label: "" }] }));
    setSel(id);
  };
  const opts = g.nodes.map((n) => ({ value: n.id, label: n.label || n.id }));
  const zones = [...new Set(g.nodes.map((n) => n.zone).filter(Boolean))];

  return (
    <Expandable toolbar={<span className="text-[12px] text-zinc-500">リソース {g.nodes.length}・通信 {g.edges.length}・ゾーン {zones.length}</span>}>
      {(full) => (<>
        {g.nodes.length === 0 ? (
          <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-zinc-300 text-[13px] text-zinc-500">
            下の表でリソースを足すか、AI に下書きを頼んでください
          </div>
        ) : (
          <div className={`overflow-hidden rounded-xl border border-zinc-200 bg-white ${full ? "h-[55vh]" : "h-[440px]"}`}>
            <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} connectionMode={ConnectionMode.Loose}
              nodesConnectable={!readOnly} minZoom={0.2} proOptions={{ hideAttribution: true }} fitView deleteKeyCode={null}
              onNodeClick={(_, n) => !n.id.startsWith("zone:") && setSel(n.id)} onEdgeClick={(_, e) => setSel(e.id)} onPaneClick={() => setSel(null)}
              onConnect={connect}
              onNodeDragStop={(_, n) => ed.change((x) => ({ ...x, nodes: x.nodes.map((r) => (r.id === n.id ? { ...r, x: Math.round(n.position.x), y: Math.round(n.position.y) } : r)) }))}>
              <Background gap={20} color="#f4f4f5" />
              <Controls showInteractive={false} position="bottom-right" />
            </ReactFlow>
          </div>
        )}
        <datalist id={`zones-${fieldKey}`}>{zones.map((z) => <option key={z} value={z} />)}</datalist>
        <div className="grid gap-3 xl:grid-cols-2">
          <div>
            <div className="mb-1 text-[12px] font-medium text-zinc-600">リソース</div>
            <MiniTable<ArchNode> readOnly={readOnly} rows={g.nodes} addLabel="リソースを追加"
              active={g.nodes.findIndex((n) => n.id === sel)} onRowClick={(i) => setSel(g.nodes[i].id)}
              blank={() => ({ id: uid("N"), label: "", kind: "compute", zone: zones[0] ?? "", note: "" })}
              onChange={(ns) => ed.change((x) => ({ nodes: ns, edges: x.edges.filter((e) => ns.some((n) => n.id === e.source) && ns.some((n) => n.id === e.target)) }))}
              cols={[{ key: "label", label: "名前" }, { key: "kind", label: "種類", kind: "select", options: KIND_OPTS },
                { key: "zone", label: "置き場所（ゾーン）", placeholder: "例：プライベート", list: `zones-${fieldKey}` }, { key: "note", label: "説明" }]} />
          </div>
          <div>
            <div className="mb-1 text-[12px] font-medium text-zinc-600">通信（図の縁の点から別のリソースへドラッグしても足せます）</div>
            <MiniTable<ArchEdge> readOnly={readOnly} rows={g.edges} addLabel="通信を追加"
              active={g.edges.findIndex((e) => e.id === sel)} onRowClick={(i) => setSel(g.edges[i].id)}
              blank={() => ({ id: uid("L"), source: g.nodes[0]?.id ?? "", target: g.nodes[1]?.id ?? "", label: "" })}
              onChange={(es) => ed.change((x) => ({ ...x, edges: es }))}
              cols={[{ key: "source", label: "通信元", kind: "select", options: opts }, { key: "target", label: "通信先", kind: "select", options: opts },
                { key: "label", label: "内容（プロトコル・ポート）" }]} />
          </div>
        </div>
        {!readOnly && <div className="flex justify-end"><SaveBar e={ed} label="構成図を保存" /></div>}
      </>)}
    </Expandable>
  );
}

const EMPTY: ArchGraph = { nodes: [], edges: [] };

export function ArchEditor(props: { pid: string; sid: string; fieldKey: string; value: ArchGraph | undefined; readOnly: boolean }) {
  return <ReactFlowProvider><Editor {...props} value={props.value ?? EMPTY} /></ReactFlowProvider>;
}
