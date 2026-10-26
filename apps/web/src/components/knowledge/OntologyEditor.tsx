"use client";
import "@xyflow/react/dist/style.css";
import { useMemo, useState, useTransition } from "react";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Connection, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { Check, Eye, List, Network, Plus, Sparkles, Trash2, Upload, X } from "lucide-react";
import type { Concept, Ontology } from "@/lib/agent";
import {
  addRelation, checkContext, deleteConcept, deleteRelation, importOntology, saveConcept, suggestConcepts,
} from "@/app/(app)/ontology/actions";

const KIND_COLOR: Record<string, string> = {
  term: "bg-sky-50 text-sky-800 ring-sky-200", org: "bg-amber-50 text-amber-800 ring-amber-200",
  role: "bg-violet-50 text-violet-800 ring-violet-200", process: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  system: "bg-rose-50 text-rose-800 ring-rose-200", other: "bg-zinc-100 text-zinc-700 ring-zinc-200",
};
const lines = (s: string) => s.split(/[\n,、]/).map((x) => x.trim()).filter(Boolean);

function KindChip({ kind, label }: { kind: string; label: string }) {
  return <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ${KIND_COLOR[kind] ?? KIND_COLOR.other}`}>{label}</span>;
}

type CNode = Node<{ c: Concept; kindLabel: string; selected: boolean }>;
function ConceptNode({ data }: NodeProps<CNode>) {
  return (
    <div className={`rounded-lg bg-white px-3 py-2 text-[12px] shadow-card ring-1 ${data.selected ? "ring-2 ring-brand-500" : "ring-zinc-200"}`}>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-zinc-400" />
      <div className="flex items-center gap-1.5"><KindChip kind={data.c.kind} label={data.kindLabel} /><span className="font-medium">{data.c.label}</span></div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-zinc-400" />
    </div>
  );
}
const nodeTypes = { concept: ConceptNode };

function Graph({ g, sel, onSelect, onConnect, canEdit }: {
  g: Ontology; sel: number | null; onSelect: (id: number) => void; onConnect: (c: Connection) => void; canEdit: boolean;
}) {
  const active = g.concepts.filter((c) => c.status === "active");
  // 種類ごとに列を分けて並べる（同じ並びなら毎回同じ位置になる）
  const nodes: CNode[] = useMemo(() => {
    const kinds = Object.keys(g.kinds);
    const seen: Record<string, number> = {};
    return active.map((c) => {
      const col = Math.max(0, kinds.indexOf(c.kind));
      const row = (seen[c.kind] = (seen[c.kind] ?? -1) + 1);
      return { id: String(c.id), type: "concept", position: { x: col * 240, y: row * 80 }, data: { c, kindLabel: g.kinds[c.kind] ?? c.kind, selected: c.id === sel } };
    });
  }, [active, g.kinds, sel]);
  const edges: Edge[] = g.relations.map((r) => ({
    id: String(r.id), source: String(r.source), target: String(r.target), label: g.relation_types[r.type] ?? r.type,
    markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: "#a1a1aa" }, labelStyle: { fontSize: 10 },
  }));
  return (
    <div className="h-[560px] rounded-xl border border-zinc-200 bg-zinc-50">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ maxZoom: 1 }} proOptions={{ hideAttribution: true }}
        nodesConnectable={canEdit} onConnect={onConnect} onNodeClick={(_, n) => onSelect(Number(n.id))}>
        <Background gap={16} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

function ConceptForm({ g, c, canEdit, onDone }: { g: Ontology; c: Concept | null; canEdit: boolean; onDone: (id: number | null) => void }) {
  const [label, setLabel] = useState(c?.label ?? "");
  const [kind, setKind] = useState(c?.kind ?? "term");
  const [definition, setDefinition] = useState(c?.definition ?? "");
  const [aliases, setAliases] = useState((c?.aliases ?? []).join("\n"));
  const [examples, setExamples] = useState((c?.examples ?? []).join("\n"));
  const [rtype, setRtype] = useState(Object.keys(g.relation_types)[0] ?? "related");
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const byId = Object.fromEntries(g.concepts.map((x) => [x.id, x]));
  const rels = c ? g.relations.filter((r) => r.source === c.id || r.target === c.id) : [];
  const run = (fn: () => Promise<{ error?: string }>, after?: () => void) => {
    setError(null);
    start(async () => { const r = await fn(); if (r.error) setError(r.error); else after?.(); });
  };
  const body = (status?: string) => ({ label, kind, definition, aliases: lines(aliases), examples: lines(examples), ...(status ? { status } : {}) });

  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-[14px] font-semibold">{c ? c.label : "概念を足す"}</h2>
        {c?.status === "proposed" && <span className="chip">AI の候補・承認待ち</span>}
        {c && <button onClick={() => onDone(null)} className="btn-ghost btn-sm ml-auto h-7 w-7 p-0" aria-label="選択を外す"><X size={14} /></button>}
      </div>
      <fieldset disabled={!canEdit || pending} className="space-y-2">
        <div className="grid grid-cols-[1fr_8rem] gap-2">
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="名前（例：月次締め）" aria-label="名前" />
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="種類">
            {Object.entries(g.kinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <textarea className="input min-h-20" value={definition} onChange={(e) => setDefinition(e.target.value)} placeholder="定義（社内でどういう意味で使うか）" aria-label="定義" />
        <div className="grid grid-cols-2 gap-2">
          <textarea className="input min-h-16 text-[12px]" value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="別名・略称（1行に1つ）" aria-label="別名" />
          <textarea className="input min-h-16 text-[12px]" value={examples} onChange={(e) => setExamples(e.target.value)} placeholder="使い方の例（1行に1つ）" aria-label="使い方の例" />
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            {c?.status === "proposed" ? (
              <>
                <button onClick={() => run(() => saveConcept(c.id, body("active")))} className="btn-primary btn-sm"><Check size={13} />承認して登録</button>
                <button onClick={() => run(() => deleteConcept(c.id), () => onDone(null))} className="btn-secondary btn-sm"><X size={13} />却下</button>
              </>
            ) : (
              <button onClick={() => run(() => saveConcept(c?.id ?? null, body()), () => { if (!c) { setLabel(""); setDefinition(""); setAliases(""); setExamples(""); } })}
                className="btn-primary btn-sm">{c ? "保存" : <><Plus size={13} />足す</>}</button>
            )}
            {c && c.status !== "proposed" && (
              <button onClick={() => { if (confirm(`「${c.label}」と、その関係を消しますか？`)) run(() => deleteConcept(c.id), () => onDone(null)); }}
                className="btn-ghost btn-sm ml-auto text-rose-600"><Trash2 size={13} />消す</button>
            )}
          </div>
        )}
      </fieldset>
      {error && <p className="text-xs text-rose-600">{error}</p>}

      {c && c.status === "active" && (
        <div className="space-y-2 border-t border-zinc-100 pt-3">
          <h3 className="text-[12px] font-semibold text-zinc-600">関係</h3>
          {rels.length === 0 && <p className="text-[12px] text-zinc-400">まだありません。</p>}
          <ul className="space-y-1">
            {rels.map((r) => (
              <li key={r.id} className="flex items-center gap-1.5 text-[12px]">
                <span className={r.source === c.id ? "font-medium" : ""}>{byId[r.source]?.label}</span>
                <span className="chip">{g.relation_types[r.type] ?? r.type}</span>
                <span className={r.target === c.id ? "font-medium" : ""}>{byId[r.target]?.label}</span>
                {canEdit && <button onClick={() => run(() => deleteRelation(r.id))} className="btn-ghost btn-sm ml-auto h-6 w-6 p-0" aria-label="関係を消す"><X size={12} /></button>}
              </li>
            ))}
          </ul>
          {canEdit && (
            <div className="flex gap-1.5">
              <select className="input h-8 w-36 shrink-0 py-0 text-[12px]" value={rtype} onChange={(e) => setRtype(e.target.value)} aria-label="関係の種類">
                {Object.entries(g.relation_types).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <select className="input h-8 min-w-0 flex-1 py-0 text-[12px]" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="相手">
                <option value="">相手を選ぶ</option>
                {g.concepts.filter((x) => x.id !== c.id && x.status === "active").map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
              <button disabled={!target || pending} onClick={() => run(() => addRelation(c.id, Number(target), rtype, ""), () => setTarget(""))} className="btn-secondary btn-sm">つなぐ</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ImportBox() {
  const [format, setFormat] = useState("turtle");
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="card space-y-2 p-4">
      <h2 className="text-[14px] font-semibold">読み込む（SKOS）</h2>
      <p className="text-[12px] text-zinc-500">他のツールや別のテナントから書き出した SKOS を貼るか、ファイルを選んでください。同じ名前の概念は上書きします。</p>
      <div className="flex gap-2">
        <select className="input h-8 w-36 py-0 text-[12px]" value={format} onChange={(e) => setFormat(e.target.value)} aria-label="形式">
          <option value="turtle">Turtle（.ttl）</option><option value="json-ld">JSON-LD</option>
        </select>
        <input type="file" accept=".ttl,.jsonld,.json,text/turtle,application/ld+json" className="text-[12px]" aria-label="ファイル"
          onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setText(await f.text()); if (/json/.test(f.name)) setFormat("json-ld"); } }} />
      </div>
      <textarea className="input min-h-32 font-mono text-[11px]" value={text} onChange={(e) => setText(e.target.value)} aria-label="読み込む内容" />
      <div className="flex items-center gap-2">
        <button disabled={!text.trim() || pending} className="btn-primary btn-sm"
          onClick={() => start(async () => { const r = await importOntology(format, text); setMsg(r.error ?? r.summary ?? null); if (!r.error) setText(""); })}>
          <Upload size={13} />{pending ? "読み込み中…" : "読み込む"}
        </button>
        {msg && <span className="text-xs text-zinc-600">{msg}</span>}
      </div>
    </div>
  );
}

function ContextCheck() {
  const [text, setText] = useState("");
  const [ctx, setCtx] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="card space-y-2 p-4">
      <h2 className="text-[14px] font-semibold">AI に渡る内容を確かめる</h2>
      <p className="text-[12px] text-zinc-500">文章を入れると、その文章を扱うときに AI が受け取る社内の用語と関係を表示します。</p>
      <textarea className="input min-h-20" value={text} onChange={(e) => setText(e.target.value)} placeholder="例：月次締めを5分で終わらせたい" aria-label="確かめる文章" />
      <button disabled={!text.trim() || pending} className="btn-secondary btn-sm"
        onClick={() => start(async () => { const r = await checkContext(text); setCtx(r.error ?? r.context ?? ""); })}><Eye size={13} />確かめる</button>
      {ctx !== null && (
        <pre className="whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-[12px] text-zinc-700">{ctx || "（この文章では、社内の用語は渡りません）"}</pre>
      )}
    </div>
  );
}

export function OntologyEditor({ g, canEdit }: { g: Ontology; canEdit: boolean }) {
  const [view, setView] = useState<"list" | "graph">("list");
  const [sel, setSel] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [connType, setConnType] = useState(Object.keys(g.relation_types)[0] ?? "related");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const cur = g.concepts.find((c) => c.id === sel) ?? null;
  const proposed = g.concepts.filter((c) => c.status === "proposed");
  const shown = g.concepts.filter((c) => c.status === "active" && (!kind || c.kind === kind)
    && (!q || [c.label, c.definition, ...c.aliases].join(" ").toLowerCase().includes(q.toLowerCase())));
  const degree = (id: number) => g.relations.filter((r) => r.source === id || r.target === id).length;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md bg-zinc-100 p-0.5">
            {([["list", "一覧", List], ["graph", "グラフ", Network]] as const).map(([k, l, I]) => (
              <button key={k} onClick={() => setView(k)} className={`flex items-center gap-1 rounded px-2.5 py-1 text-[12px] font-medium ${view === k ? "bg-white text-zinc-900 shadow-card" : "text-zinc-500"}`}><I size={13} />{l}</button>
            ))}
          </div>
          {view === "list" ? (
            <>
              <input className="input h-8 w-48 py-0 text-[12px]" value={q} onChange={(e) => setQ(e.target.value)} placeholder="名前・別名・定義で探す" aria-label="探す" />
              <select className="input h-8 w-32 py-0 text-[12px]" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="種類で絞る">
                <option value="">種類：すべて</option>
                {Object.entries(g.kinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </>
          ) : canEdit && (
            <label className="flex items-center gap-1.5 text-[12px] text-zinc-500">点どうしをつなぐと
              <select className="input h-8 w-36 py-0 text-[12px]" value={connType} onChange={(e) => setConnType(e.target.value)} aria-label="つないだときの関係">
                {Object.entries(g.relation_types).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
          )}
          {canEdit && (
            <button disabled={pending} className="btn-secondary btn-sm ml-auto"
              onClick={() => start(async () => { const r = await suggestConcepts(); setMsg(r.error ?? `候補 ${r.count ?? 0}件`); })}>
              <Sparkles size={13} />{pending ? "探しています…" : "決定記録・ドキュメントから候補を出す"}
            </button>
          )}
        </div>
        {msg && <p className="text-xs text-zinc-600">{msg}</p>}

        {proposed.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="mb-2 text-[12px] font-semibold text-amber-900">AI の候補（承認すると AI に渡るようになります）</div>
            <div className="flex flex-wrap gap-1.5">
              {proposed.map((c) => (
                <button key={c.id} onClick={() => setSel(c.id)} className={`rounded-full bg-white px-2.5 py-1 text-[12px] ring-1 ${sel === c.id ? "ring-brand-500" : "ring-amber-200"}`}>{c.label}</button>
              ))}
            </div>
          </div>
        )}

        {view === "graph" ? (
          <Graph g={g} sel={sel} onSelect={setSel} canEdit={canEdit}
            onConnect={(cn) => { if (cn.source && cn.target) start(async () => { const r = await addRelation(Number(cn.source), Number(cn.target), connType, ""); if (r.error) setMsg(r.error); }); }} />
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="bg-zinc-50 text-left text-zinc-500">
                <tr><th className="px-3 py-2">名前</th><th className="px-3 py-2">種類</th><th className="px-3 py-2">定義</th><th className="px-3 py-2">別名</th><th className="px-3 py-2 text-right">関係</th></tr>
              </thead>
              <tbody>
                {shown.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-zinc-400">{g.concepts.length ? "条件に合う概念がありません" : "まだありません。右のフォームから足すか、SKOS を読み込んでください"}</td></tr>}
                {shown.map((c) => (
                  <tr key={c.id} onClick={() => setSel(c.id)} className={`cursor-pointer border-t border-zinc-100 hover:bg-zinc-50 ${sel === c.id ? "bg-brand-50/60" : ""}`}>
                    <td className="px-3 py-2 font-medium">{c.label}</td>
                    <td className="px-3 py-2"><KindChip kind={c.kind} label={g.kinds[c.kind] ?? c.kind} /></td>
                    <td className="max-w-md truncate px-3 py-2 text-zinc-600">{c.definition}</td>
                    <td className="px-3 py-2 text-zinc-500">{c.aliases.join("・")}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{degree(c.id)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <ConceptForm key={cur ? `${cur.id}-${cur.updated_at}-${cur.status}` : "new"} g={g} c={cur} canEdit={canEdit} onDone={setSel} />
        <ContextCheck />
        {canEdit && <ImportBox />}
      </div>
    </div>
  );
}
