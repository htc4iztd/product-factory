"use client";
import "@xyflow/react/dist/style.css";
import { useMemo, useState } from "react";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { GanttChart, List, Workflow } from "lucide-react";
import type { JobTask } from "@/lib/agent";
import { TASK_STATUS, TaskLegend, duration } from "@/components/autodev/JobBits";

const ms = (s: string | null) => (s ? new Date(s).getTime() : null);
const secs = (t: JobTask, now: number) => {
  const a = ms(t.started_at);
  if (a == null) return null;
  return Math.max(0, Math.round(((ms(t.finished_at) ?? now) - a) / 1000));
};
const time = (s: string | null) => (s ? new Date(s).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo" }) : "—");

// 依存の深さ（根からの最長の段数）で列を決める
function depths(tasks: JobTask[]): Record<string, number> {
  const by = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const memo: Record<string, number> = {};
  const d = (id: string, seen: Set<string>): number => {
    if (id in memo) return memo[id];
    const t = by[id];
    if (!t || seen.has(id)) return 0;
    seen.add(id);
    const v = t.deps.length ? 1 + Math.max(...t.deps.map((x) => d(x, seen))) : 0;
    return (memo[id] = v);
  };
  tasks.forEach((t) => d(t.id, new Set()));
  return memo;
}

type TNode = Node<{ t: JobTask; selected: boolean; sec: number | null }>;
function TaskNode({ data }: NodeProps<TNode>) {
  const s = TASK_STATUS[data.t.status] ?? TASK_STATUS.pending;
  return (
    <div className={`w-[180px] rounded-lg border-2 px-2.5 py-1.5 text-[11px] shadow-sm ${s.node} ${data.selected ? "ring-2 ring-brand-500 ring-offset-1" : ""}`}>
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !border-0 !bg-zinc-400" />
      {data.t.group && <div className="truncate text-[10px] opacity-70">{data.t.group}</div>}
      <div className="truncate font-semibold">{data.t.name}</div>
      <div className="flex justify-between text-[10px] opacity-80"><span>{s.label}</span><span>{data.sec != null ? duration(data.sec) : ""}</span></div>
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !border-0 !bg-zinc-400" />
    </div>
  );
}
const nodeTypes = { task: TaskNode };

function Graph({ tasks, sel, onSelect, now }: { tasks: JobTask[]; sel: string | null; onSelect: (id: string) => void; now: number }) {
  const { nodes, edges } = useMemo(() => {
    const dep = depths(tasks);
    const cols: Record<number, JobTask[]> = {};
    tasks.forEach((t) => (cols[dep[t.id]] ??= []).push(t));
    const nodes: TNode[] = [];
    for (const [c, ts] of Object.entries(cols)) {
      ts.forEach((t, i) => nodes.push({
        id: t.id, type: "task", position: { x: Number(c) * 220, y: (i - (ts.length - 1) / 2) * 80 },
        data: { t, selected: t.id === sel, sec: secs(t, now) },
      }));
    }
    const edges: Edge[] = tasks.flatMap((t) => t.deps.map((d) => ({
      id: `${d}->${t.id}`, source: d, target: t.id, markerEnd: { type: MarkerType.ArrowClosed },
      animated: t.status === "running", style: { stroke: "#a1a1aa" },
    })));
    return { nodes, edges };
  }, [tasks, sel, now]);
  return (
    <div className="h-[460px] rounded-xl border border-zinc-200 bg-zinc-50">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ maxZoom: 1 }} nodesDraggable={false}
        nodesConnectable={false} proOptions={{ hideAttribution: true }} onNodeClick={(_, n) => onSelect(n.id)}>
        <Background gap={16} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

function Gantt({ tasks, sel, onSelect, now }: { tasks: JobTask[]; sel: string | null; onSelect: (id: string) => void; now: number }) {
  const starts = tasks.map((t) => ms(t.started_at)).filter((x): x is number => x != null);
  if (starts.length === 0) return <p className="py-8 text-center text-[13px] text-zinc-400">まだ始まった工程がありません</p>;
  const t0 = Math.min(...starts);
  const t1 = Math.max(...tasks.map((t) => (t.started_at ? ms(t.finished_at) ?? now : t0)));
  const span = Math.max(1, t1 - t0);
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[14rem_1fr_4rem] gap-2 text-[10px] text-zinc-400">
        <span /><div className="flex justify-between"><span>{time(new Date(t0).toISOString())}</span><span>{duration(Math.round(span / 1000))}</span></div><span />
      </div>
      {tasks.map((t) => {
        const a = ms(t.started_at);
        const s = TASK_STATUS[t.status] ?? TASK_STATUS.pending;
        const left = a == null ? 0 : ((a - t0) / span) * 100;
        const width = a == null ? 0 : Math.max(0.6, (((ms(t.finished_at) ?? now) - a) / span) * 100);
        return (
          <button key={t.id} onClick={() => onSelect(t.id)} className={`grid w-full grid-cols-[14rem_1fr_4rem] items-center gap-2 rounded px-1 py-0.5 text-left text-[11px] hover:bg-zinc-50 ${sel === t.id ? "bg-brand-50" : ""}`}>
            <span className="truncate"><span className="text-zinc-400">{t.group ? `${t.group.split("：")[0]} ` : ""}</span>{t.name}</span>
            <span className="relative h-3 rounded bg-zinc-100">
              {a != null && <span className={`absolute inset-y-0 rounded ${s.bar}`} style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }} />}
            </span>
            <span className="text-right tabular-nums text-zinc-500">{a != null ? duration(secs(t, now)) : s.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function TaskTable({ tasks, sel, onSelect, now }: { tasks: JobTask[]; sel: string | null; onSelect: (id: string) => void; now: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead className="bg-zinc-50 text-left text-zinc-500">
          <tr><th className="px-3 py-2">工程</th><th className="px-3 py-2">まとまり</th><th className="px-3 py-2">状態</th><th className="px-3 py-2">開始</th>
            <th className="px-3 py-2">所要</th><th className="px-3 py-2 text-right">トークン（入力／出力）</th><th className="px-3 py-2">結果・理由</th></tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const s = TASK_STATUS[t.status] ?? TASK_STATUS.pending;
            return (
              <tr key={t.id} onClick={() => onSelect(t.id)} className={`cursor-pointer border-t border-zinc-100 align-top hover:bg-zinc-50 ${sel === t.id ? "bg-brand-50/60" : ""}`}>
                <td className="px-3 py-2 font-medium">{t.name}</td>
                <td className="px-3 py-2 text-zinc-500">{t.group || "—"}</td>
                <td className="px-3 py-2"><span className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-sm ${s.dot}`} />{s.label}</span></td>
                <td className="px-3 py-2 tabular-nums text-zinc-500">{time(t.started_at)}</td>
                <td className="px-3 py-2 tabular-nums">{duration(secs(t, now))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{t.usage ? `${t.usage.input_tokens.toLocaleString("ja-JP")}／${t.usage.output_tokens.toLocaleString("ja-JP")}` : "—"}</td>
                <td className="max-w-md px-3 py-2">{t.error ? <span className="text-rose-700">{t.error}</span> : <span className="text-zinc-600">{t.detail}</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ジョブの工程を、グラフ（依存関係）・ガント（時間）・一覧で見る
export function TaskViews({ tasks, now }: { tasks: JobTask[]; now: number }) {
  const [view, setView] = useState<"graph" | "gantt" | "table">("graph");
  const [sel, setSel] = useState<string | null>(null);
  const cur = tasks.find((t) => t.id === sel) ?? null;
  const count = (st: string) => tasks.filter((t) => t.status === st).length;
  if (tasks.length === 0) return <p className="text-[13px] text-zinc-400">このジョブには工程の記録がありません（工程の記録を入れる前に動いたジョブです）。</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-md bg-zinc-100 p-0.5">
          {([["graph", "グラフ", Workflow], ["gantt", "ガント", GanttChart], ["table", "工程の一覧", List]] as const).map(([k, l, I]) => (
            <button key={k} onClick={() => setView(k)} className={`flex items-center gap-1 rounded px-2.5 py-1 text-[12px] font-medium ${view === k ? "bg-white text-zinc-900 shadow-card" : "text-zinc-500"}`}><I size={13} />{l}</button>
          ))}
        </div>
        <span className="text-[12px] text-zinc-500">
          {tasks.length}工程：完了 {count("done")}・実行中 {count("running")}・待ち {count("pending")}{count("failed") ? `・失敗 ${count("failed")}` : ""}{count("skipped") ? `・飛ばした ${count("skipped")}` : ""}{count("cancelled") ? `・取り消し ${count("cancelled")}` : ""}
        </span>
        <span className="ml-auto"><TaskLegend /></span>
      </div>
      {view === "graph" && <Graph tasks={tasks} sel={sel} onSelect={setSel} now={now} />}
      {view === "gantt" && <Gantt tasks={tasks} sel={sel} onSelect={setSel} now={now} />}
      {view === "table" && <TaskTable tasks={tasks} sel={sel} onSelect={setSel} now={now} />}
      {cur && view !== "table" && (
        <div className="rounded-lg border border-zinc-200 bg-white p-3 text-[12px]" aria-label="選んだ工程">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-sm ${(TASK_STATUS[cur.status] ?? TASK_STATUS.pending).dot}`} />
            <span className="font-semibold">{cur.group ? `${cur.group} / ` : ""}{cur.name}</span>
            <span className="text-zinc-500">{(TASK_STATUS[cur.status] ?? TASK_STATUS.pending).label}</span>
            <span className="ml-auto font-mono text-[10px] text-zinc-400">{cur.id}</span>
          </div>
          <dl className="mt-2 grid grid-cols-[7rem_1fr] gap-y-1">
            <dt className="text-zinc-500">前の工程</dt><dd>{cur.deps.map((d) => tasks.find((x) => x.id === d)?.name ?? d).join("、") || "なし"}</dd>
            <dt className="text-zinc-500">時刻</dt><dd>{time(cur.started_at)} 〜 {time(cur.finished_at)}（{duration(secs(cur, now))}）</dd>
            <dt className="text-zinc-500">トークン</dt><dd>{cur.usage ? `入力 ${cur.usage.input_tokens.toLocaleString("ja-JP")}・出力 ${cur.usage.output_tokens.toLocaleString("ja-JP")}（${cur.usage.calls}回）` : "—"}</dd>
            {cur.detail && <><dt className="text-zinc-500">結果</dt><dd>{cur.detail}</dd></>}
            {cur.error && <><dt className="text-zinc-500">失敗の理由</dt><dd className="text-rose-700">{cur.error}</dd></>}
          </dl>
        </div>
      )}
    </div>
  );
}
