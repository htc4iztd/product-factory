"use client";
import "@xyflow/react/dist/style.css";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Background, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import { Compass, GitBranch, ListChecks, Mail, Network, Users } from "lucide-react";
import type { Dashboard, StageSummary, TeamMember } from "@/lib/agent";

// ダッシュボードのグラフ。2つの見方：
// - 組織と工程：司令塔・PM・各工程の担当。工程のつながり（灰色）と、最近のエージェント同士のやり取り（色つき・動く線）
// - 案ごと：本線と各案（PP-n）を行に、工程を列にして、どの案がどの工程まで進んでいるか
const HEALTH: Record<string, { dot: string; label: string }> = {
  green: { dot: "bg-emerald-500", label: "順調" }, yellow: { dot: "bg-amber-400", label: "注意" },
  red: { dot: "bg-rose-500", label: "止まっている" },
};
const STATUS: Record<string, string> = {
  not_started: "未着手", in_progress: "作業中", awaiting_approval: "承認待ち", revising: "修正中", completed: "完了",
  skipped: "スキップ", needs_recheck: "要再確認",
};
const INTENT: Record<string, string> = { report: "報告", request: "依頼", answer: "回答", decision: "決定", directive: "指示", question: "質問" };
const PHASE_ORDER = ["P1", "P2", "P3", "P4", "P5"];
const COL = 268, ROW = 140;

type AData = { m: TeamMember; stage?: StageSummary; variants: { key: string; status: string; number: number }[]; pid: string; active: boolean };

function Hd() {
  const c = "!h-1.5 !w-1.5 !min-h-0 !min-w-0 !border-0 !bg-transparent";
  return (<>
    <Handle type="target" position={Position.Left} id="l" className={c} /><Handle type="source" position={Position.Right} id="r" className={c} />
    <Handle type="target" position={Position.Top} id="t" className={c} /><Handle type="source" position={Position.Bottom} id="b" className={c} />
  </>);
}

function AgentNode({ data }: NodeProps<Node<AData>>) {
  const { m, stage, variants, active } = data;
  const rep = m.report;
  const lead = m.role !== "stage";
  const off = stage && !stage.enabled;
  return (
    <div className={`w-60 rounded-xl border bg-white p-2.5 text-[11px] shadow-card transition ${active ? "border-brand-500 ring-4 ring-brand-100" : lead ? "border-zinc-800" : "border-zinc-200"} ${off ? "opacity-50" : ""}`}>
      <Hd />
      <div className="flex items-center gap-1.5">
        {m.role === "director" ? <Compass size={13} className="text-brand-600" /> : m.role === "pm" ? <Users size={13} className="text-brand-600" /> : null}
        <span className="truncate text-[12px] font-semibold text-zinc-900">{m.name}</span>
        <span className={`ml-auto h-2 w-2 shrink-0 rounded-full ${rep ? HEALTH[rep.health]?.dot ?? "bg-zinc-300" : "bg-zinc-200"}`} title={rep ? HEALTH[rep.health]?.label : "まだ報告がない"} />
      </div>
      {stage && (
        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-500">
          <span>{off ? "閉じている" : STATUS[stage.status] ?? stage.status}</span>
          {stage.approved_version > 0 && <span>v{stage.approved_version}</span>}
          {stage.pending_kind === "approval" && <span className="text-amber-600">承認待ち</span>}
        </div>
      )}
      {rep && m.role === "stage" && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full bg-brand-500" style={{ width: `${rep.progress}%` }} /></div>
      )}
      <p className="mt-1.5 line-clamp-2 min-h-[2.4em] text-zinc-600">{rep?.summary || (lead ? m.mission : "まだ動いていません")}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px]">
        {m.open_tasks > 0 && <span className="flex items-center gap-0.5 rounded bg-zinc-100 px-1 text-zinc-600"><ListChecks size={10} />{m.open_tasks}</span>}
        {m.unread > 0 && <span className="flex items-center gap-0.5 rounded bg-amber-100 px-1 text-amber-800"><Mail size={10} />未読 {m.unread}</span>}
        {variants.map((v) => (
          <span key={v.key} className={`rounded px-1 font-medium ${v.status === "adopted" ? "bg-emerald-100 text-emerald-800" : v.status === "generating" ? "bg-sky-100 text-sky-800" : "bg-violet-100 text-violet-800"}`}>{v.key}</span>
        ))}
      </div>
    </div>
  );
}

type VData = { label: string; sub: string; tone: string; href: string };
function CellNode({ data }: NodeProps<Node<VData>>) {
  return (
    <Link href={data.href} className={`block w-40 rounded-lg border px-2 py-1.5 text-[11px] shadow-card ${data.tone}`}>
      <Hd />
      <div className="truncate font-semibold">{data.label}</div>
      <div className="truncate text-[10px] opacity-80">{data.sub}</div>
    </Link>
  );
}
type LData = { label: string; sub: string };
function LaneNode({ data }: NodeProps<Node<LData>>) {
  return <div className="w-36 rounded-lg bg-zinc-900 px-2 py-1.5 text-[11px] text-white"><Hd /><div className="truncate font-semibold">{data.label}</div><div className="truncate text-[10px] text-zinc-300">{data.sub}</div></div>;
}
const nodeTypes = { agent: AgentNode, cell: CellNode, lane: LaneNode };

function OrgGraph({ d, pid, sel, onSelect }: { d: Dashboard; pid: string; sel: string | null; onSelect: (k: string | null) => void }) {
  const stages = Object.fromEntries(d.stages.map((s) => [s.id, s]));
  const phases = Object.fromEntries(d.phases.map((p) => [p.id, p.stages]));
  // 列はフェーズごと。4つより多い工程を持つフェーズ（要求・設計）は2列に分ける
  const cols: string[][] = PHASE_ORDER.flatMap((ph) => {
    const ids = phases[ph] ?? [];
    return ids.length > 4 ? [ids.slice(0, Math.ceil(ids.length / 2)), ids.slice(Math.ceil(ids.length / 2))] : [ids];
  });
  const mid = ((cols.length - 1) * COL) / 2;
  const pos: Record<string, { x: number; y: number }> = { director: { x: mid - COL * 0.6, y: 0 }, pm: { x: mid + COL * 0.6, y: 0 } };
  cols.forEach((ids, i) => ids.forEach((sid, j) => { pos[sid] = { x: i * COL, y: ROW * 1.4 + j * ROW }; }));
  const vOf = (sid: string) => d.variants.filter((v) => v.stages.includes(sid)).map((v) => ({ key: v.key, status: v.status, number: v.number }));
  const nodes: Node<AData>[] = d.agents.filter((m) => pos[m.key]).map((m) => ({
    id: m.key, type: "agent", position: pos[m.key], draggable: false,
    data: { m, stage: stages[m.key], variants: vOf(m.key), pid, active: sel === m.key },
  }));
  const deps: Edge[] = [];
  for (const p of PHASE_ORDER) for (const sid of phases[p] ?? []) {
    // 工程のつながり：前の工程（同じ列の1つ上、または前の列の最後）から
    const flat = PHASE_ORDER.flatMap((x) => phases[x] ?? []);
    const i = flat.indexOf(sid);
    if (i > 0) {
      const prev = flat[i - 1];
      const sameCol = pos[prev].x === pos[sid].x;
      deps.push({ id: `dep-${prev}-${sid}`, source: prev, target: sid, sourceHandle: sameCol ? "b" : "r", targetHandle: sameCol ? "t" : "l",
        type: "smoothstep", style: { stroke: "#d4d4d8", strokeWidth: 1.2 } });
    }
  }
  const talk: Edge[] = d.edges.filter((e) => pos[e.source] && pos[e.target]).map((e) => {
    const a = pos[e.source], b = pos[e.target];
    const down = Math.abs(b.y - a.y) > Math.abs(b.x - a.x);
    return {
      id: `talk-${e.source}-${e.target}`, source: e.source, target: e.target, animated: true, type: "default",
      sourceHandle: down ? (b.y > a.y ? "b" : "t") : (b.x > a.x ? "r" : "l"), targetHandle: down ? (b.y > a.y ? "t" : "b") : (b.x > a.x ? "l" : "r"),
      label: `${INTENT[e.last.intent] ?? e.last.intent} ${e.count}`, labelStyle: { fontSize: 10, fontWeight: 700, fill: "#4338ca" },
      labelBgStyle: { fill: "#eef2ff" }, labelBgPadding: [4, 2] as [number, number],
      markerEnd: { type: MarkerType.ArrowClosed, color: "#6366f1" }, style: { stroke: "#6366f1", strokeWidth: 1.6 },
    };
  });
  return (
    <ReactFlow nodes={nodes} edges={[...deps, ...talk]} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.04 }} minZoom={0.2} proOptions={{ hideAttribution: true }}
      nodesConnectable={false} onNodeClick={(_, n) => onSelect(n.id)} onPaneClick={() => onSelect(null)}>
      <Background gap={24} color="#f4f4f5" />
      <Controls showInteractive={false} position="bottom-right" />
    </ReactFlow>
  );
}

function VariantGraph({ d, pid }: { d: Dashboard; pid: string }) {
  const stages = Object.fromEntries(d.stages.map((s) => [s.id, s]));
  const cols = [...new Set(d.variants.flatMap((v) => v.stages))].sort();
  if (!cols.length) {
    return <div className="flex h-full items-center justify-center text-[13px] text-zinc-400">まだ案（プリプロダクト）がありません。工程の画面の「以降の工程を自動開発する」で作れます。</div>;
  }
  const order = d.stages.map((s) => s.id);
  const base = order[Math.max(0, order.indexOf(cols[0]) - 1)];
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  nodes.push({ id: `base`, type: "cell", position: { x: 0, y: (d.variants.length * 90) / 2 }, draggable: false,
    data: { label: `${stages[base].no}${stages[base].name}`, sub: `分かれる前・${STATUS[stages[base].status]}`, tone: "border-zinc-300 bg-white", href: `/p/${pid}/s/${base}` } });
  const rows = [{ key: "本線", sub: "今の下書き・版", number: 0, status: "main", stages: cols }, ...d.variants];
  rows.forEach((v, r) => {
    const y = r * 90;
    nodes.push({ id: `lane-${r}`, type: "lane", position: { x: 210, y }, draggable: false, data: { label: v.key, sub: "title" in v ? String(v.title) : v.sub } });
    edges.push({ id: `b-${r}`, source: "base", target: `lane-${r}`, sourceHandle: "r", targetHandle: "l", type: "smoothstep",
      style: { stroke: r ? "#a78bfa" : "#71717a", strokeDasharray: r ? "4 3" : undefined } });
    let prev = `lane-${r}`;
    cols.forEach((sid, c) => {
      const has = r === 0 || v.stages.includes(sid);
      if (!has) return;
      const s = stages[sid];
      const tone = r === 0
        ? (s.status === "completed" ? "border-emerald-300 bg-emerald-50" : s.status === "not_started" ? "border-zinc-200 bg-white" : "border-sky-300 bg-sky-50")
        : v.status === "adopted" ? "border-emerald-300 bg-emerald-50" : v.status === "generating" ? "border-sky-300 bg-sky-50" : "border-violet-300 bg-violet-50";
      const id = `c-${r}-${sid}`;
      nodes.push({ id, type: "cell", position: { x: 400 + c * 190, y }, draggable: false,
        data: { label: `${s.no}${s.name}`, sub: r === 0 ? STATUS[s.status] : ({ ready: "下書きあり", adopted: "採用済み", generating: "作成中" } as Record<string, string>)[v.status] ?? v.status,
          tone, href: r === 0 ? `/p/${pid}/s/${sid}` : `/p/${pid}/s/${sid}?pp=${v.number}` } });
      edges.push({ id: `e-${r}-${sid}`, source: prev, target: id, sourceHandle: "r", targetHandle: "l", type: "smoothstep",
        animated: r > 0 && v.status === "generating", style: { stroke: r ? "#a78bfa" : "#a1a1aa" } });
      prev = id;
    });
  });
  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView minZoom={0.2} proOptions={{ hideAttribution: true }} nodesConnectable={false}>
      <Background gap={24} color="#f4f4f5" />
      <Controls showInteractive={false} position="bottom-right" />
    </ReactFlow>
  );
}

export function TeamGraph({ d, pid }: { d: Dashboard; pid: string }) {
  const [mode, setMode] = useState<"org" | "variants">("org");
  const [sel, setSel] = useState<string | null>(null);
  const m = useMemo(() => d.agents.find((a) => a.key === sel) ?? null, [d.agents, sel]);
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-100 px-3 py-2" role="tablist" aria-label="グラフの見方">
        {([["org", "組織と工程", Network], ["variants", "案ごと", GitBranch]] as const).map(([k, l, Icon]) => (
          <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[12px] font-medium ${mode === k ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}>
            <Icon size={12} />{l}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-3 text-[11px] text-zinc-500">
          {Object.entries(HEALTH).map(([k, h]) => <span key={k} className="flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${h.dot}`} />{h.label}</span>)}
          <span className="flex items-center gap-1"><span className="h-0.5 w-4 bg-brand-500" />この7日のやり取り</span>
        </span>
      </div>
      <div className="relative h-[560px]">
        <ReactFlowProvider>{mode === "org" ? <OrgGraph d={d} pid={pid} sel={sel} onSelect={setSel} /> : <VariantGraph d={d} pid={pid} />}</ReactFlowProvider>
        {mode === "org" && m && (
          <div className="absolute right-3 top-3 w-80 space-y-2 rounded-xl border border-zinc-200 bg-white/95 p-3 text-[12px] shadow-pop backdrop-blur" aria-label={`${m.name}の報告`}>
            <div className="flex items-center gap-1.5">
              <span className="font-semibold">{m.name}</span>
              {m.report && <span className={`h-2 w-2 rounded-full ${HEALTH[m.report.health]?.dot}`} />}
              {m.report && m.role === "stage" && <span className="text-zinc-500">{m.report.progress}%</span>}
              <button className="ml-auto text-zinc-400 hover:text-zinc-700" onClick={() => setSel(null)} aria-label="閉じる">×</button>
            </div>
            <p className="text-zinc-700">{m.report?.summary || "まだ報告がありません"}</p>
            {!!m.report?.blockers.length && <div><div className="text-[11px] font-medium text-rose-700">障害</div><ul className="list-disc pl-4">{m.report.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul></div>}
            {!!m.report?.next.length && <div><div className="text-[11px] font-medium text-zinc-500">次にやること</div><ul className="list-disc pl-4">{m.report.next.map((b, i) => <li key={i}>{b}</li>)}</ul></div>}
            <div className="text-[11px] text-zinc-400">使命：{m.mission}</div>
            <div className="flex gap-2 pt-1">
              {m.role === "stage" && <Link href={`/p/${pid}/s/${m.key}`} className="btn-secondary btn-sm">工程を開いて話す</Link>}
              <Link href={`/p/${pid}/board?agent=${m.key}`} className="btn-ghost btn-sm">掲示板で見る</Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
