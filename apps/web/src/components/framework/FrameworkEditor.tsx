"use client";
import { useRef, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Copy, Plus, Save, Trash2 } from "lucide-react";
import type { BlockDef, FrameworkDefT } from "@/lib/agent";
import { deleteFramework, saveFramework } from "@/app/(app)/p/[id]/cast-actions";

const SOURCE: Record<string, [string, string]> = {
  builtin: ["標準", "bg-zinc-100 text-zinc-600"], override: ["上書き", "bg-amber-100 text-amber-800"], custom: ["独自", "bg-violet-100 text-violet-800"],
};
const STAGES = ["s01", "s02", "s03", "s04", "s05", "s06", "s07", "s08", "s09", "s10", "s11", "s12", "s13", "s14"];
const NO = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭";
const EMPTY: FrameworkDefT = { id: "", name: "", category: "", description: "", stages: [], blocks: [], source: "custom" };
const TONE: Record<string, string> = { text: "bg-sky-50 border-sky-200", list: "bg-emerald-50 border-emerald-200", table: "bg-amber-50 border-amber-200", matrix: "bg-rose-50 border-rose-200", positioning: "bg-violet-50 border-violet-200", diagram: "bg-indigo-50 border-indigo-200" };

// フレームワークのライブラリとエディタ：部品（文章・箇条書き・表・2×2・ポジショニング図・図）を 12 列の格子に並べて定義する
export function FrameworkLibrary({ pid, frameworks, kinds, canEdit }: { pid: string; frameworks: FrameworkDefT[]; kinds: Record<string, string>; canEdit: boolean }) {
  const [sel, setSel] = useState(frameworks[0]?.id ?? "");
  const [draft, setDraft] = useState<FrameworkDefT | null>(null); // 新しく作る・複製
  const [note, setNote] = useState<string | null>(null);
  const cats = Array.from(new Set(frameworks.map((f) => f.category || "その他")));
  const cur = draft ?? frameworks.find((f) => f.id === sel) ?? EMPTY;
  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div className="card max-h-[820px] overflow-y-auto">
        {canEdit && <button className="btn-secondary btn-sm m-2" onClick={() => { setDraft({ ...EMPTY, blocks: [{ key: "notes", label: "メモ", kind: "text", hint: "", layout: { x: 0, y: 0, w: 12, h: 1 } }] }); setNote(null); }}><Plus size={12} />フレームワークを作る</button>}
        {cats.map((c) => (
          <div key={c}>
            <div className="section-title px-3 pt-2">{c}</div>
            <ul>
              {frameworks.filter((f) => (f.category || "その他") === c).map((f) => (
                <li key={f.id}>
                  <button onClick={() => { setSel(f.id); setDraft(null); setNote(null); }} aria-pressed={!draft && sel === f.id}
                    className={`flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[12.5px] ${!draft && sel === f.id ? "bg-brand-50" : "hover:bg-zinc-50"}`}>
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className={`rounded px-1 text-[10px] ${SOURCE[f.source][1]}`}>{SOURCE[f.source][0]}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {note && <p className="rounded-lg bg-emerald-50 px-3 py-1.5 text-[12px] text-emerald-800" role="status">{note}</p>}
        <Editor key={(draft ? "new" : cur.id) + cur.source} pid={pid} fw={cur} isNew={!!draft} kinds={kinds} canEdit={canEdit}
          onDuplicate={() => setDraft({ ...cur, id: `${cur.id}-copy`, name: `${cur.name}（コピー）`, source: "custom" })}
          onSaved={(id, m) => { setDraft(null); setSel(id); setNote(m); }} />
      </div>
    </div>
  );
}

function Editor({ pid, fw, isNew, kinds, canEdit, onSaved, onDuplicate }: {
  pid: string; fw: FrameworkDefT; isNew: boolean; kinds: Record<string, string>; canEdit: boolean;
  onSaved: (id: string, msg: string) => void; onDuplicate: () => void;
}) {
  const [d, setD] = useState<FrameworkDefT>(fw);
  const [cur, setCur] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ro = !canEdit;
  const setBlock = (i: number, b: Partial<BlockDef>) => setD({ ...d, blocks: d.blocks.map((x, j) => (j === i ? { ...x, ...b } : x)) });
  const addBlock = (kind: BlockDef["kind"]) => {
    const y = Math.max(0, ...d.blocks.map((b) => b.layout.y + b.layout.h));
    const n = d.blocks.length + 1;
    const base: BlockDef = { key: `block${n}`, label: `${kinds[kind]}${n}`, kind, hint: "", layout: { x: 0, y, w: kind === "text" || kind === "list" ? 6 : 12, h: kind === "matrix" || kind === "positioning" || kind === "diagram" ? 2 : 1 } };
    if (kind === "table") base.columns = [{ key: "item", label: "項目", kind: "text", options: [] }, { key: "note", label: "メモ", kind: "text", options: [] }];
    if (kind === "matrix") base.quadrants = ["左上", "右上", "左下", "右下"];
    if (kind === "matrix" || kind === "positioning") base.axes = { x: { label: "横軸", low: "低", high: "高" }, y: { label: "縦軸", low: "低", high: "高" } };
    if (kind === "diagram") base.node_kinds = [];
    setD({ ...d, blocks: [...d.blocks, base] });
    setCur(d.blocks.length);
  };
  const save = () => start(async () => {
    setErr(null);
    const r = await saveFramework(pid, d.id, { name: d.name, category: d.category, description: d.description, stages: d.stages, blocks: d.blocks });
    if (r.error) setErr(r.error); else onSaved(d.id, fw.source === "builtin" && !isNew ? "標準を上書きしました" : "保存しました");
  });
  const del = () => start(async () => { const r = await deleteFramework(pid, fw.id); if (r.error) setErr(r.error); else onSaved(fw.id, fw.source === "override" ? "標準に戻しました" : "消しました"); });
  const b = d.blocks[cur];
  return (
    <section className="card space-y-4 p-4" aria-label="フレームワークの編集">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-semibold">{isNew ? "新しいフレームワーク" : d.name}</h2>
        {!isNew && <span className={`rounded px-1.5 text-[10.5px] ${SOURCE[fw.source][1]}`}>{SOURCE[fw.source][0]}</span>}
        {canEdit && !isNew && <button className="btn-ghost btn-sm ml-auto" onClick={onDuplicate}><Copy size={12} />複製して作る</button>}
      </div>
      {fw.source === "builtin" && !isNew && canEdit && <p className="text-[11.5px] text-amber-700">標準のフレームワークです。保存するとこのテナントだけで上書きします（消すと標準に戻ります）。</p>}
      <div className="grid gap-2 md:grid-cols-3">
        <label className="text-[11.5px] text-zinc-500">id（英小文字・数字・ハイフン）<input className="input mt-0.5 text-[12.5px]" value={d.id} disabled={!isNew || ro} aria-label="フレームワークの id" onChange={(e) => setD({ ...d, id: e.target.value })} /></label>
        <label className="text-[11.5px] text-zinc-500">名前<input className="input mt-0.5 text-[12.5px]" value={d.name} disabled={ro} aria-label="フレームワークの名前" onChange={(e) => setD({ ...d, name: e.target.value })} /></label>
        <label className="text-[11.5px] text-zinc-500">分類<input className="input mt-0.5 text-[12.5px]" value={d.category} disabled={ro} aria-label="分類" onChange={(e) => setD({ ...d, category: e.target.value })} /></label>
      </div>
      <label className="block text-[11.5px] text-zinc-500">何を決めるためのものか<input className="input mt-0.5 text-[12.5px]" value={d.description} disabled={ro} aria-label="説明" onChange={(e) => setD({ ...d, description: e.target.value })} /></label>
      <div className="flex flex-wrap items-center gap-1 text-[11.5px] text-zinc-500">向いている工程：
        {STAGES.map((s, i) => (
          <button key={s} disabled={ro} onClick={() => setD({ ...d, stages: d.stages.includes(s) ? d.stages.filter((x) => x !== s) : [...d.stages, s] })}
            className={`h-6 w-6 rounded-full border text-[12px] ${d.stages.includes(s) ? "border-brand-400 bg-brand-50 text-brand-800" : "border-zinc-200 text-zinc-500"}`} aria-pressed={d.stages.includes(s)} aria-label={`工程 ${s}`}>{NO[i]}</button>
        ))}
      </div>

      <div>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold">配置（12 列の格子。ドラッグで動かし、右下の角で大きさを変える）</span>
          {!ro && Object.entries(kinds).map(([k, l]) => <button key={k} className="btn-secondary btn-sm" onClick={() => addBlock(k as BlockDef["kind"])}><Plus size={11} />{l}</button>)}
        </div>
        <Grid blocks={d.blocks} cur={cur} setCur={setCur} ro={ro} onLayout={(i, layout) => setBlock(i, { layout })} />
      </div>

      {b && (
        <div className="rounded-lg border border-zinc-200 p-3" aria-label="部品の設定">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[13px] font-semibold">部品：{b.label}</span>
            <span className="rounded bg-zinc-100 px-1.5 text-[10.5px] text-zinc-600">{kinds[b.kind]}</span>
            {!ro && (
              <span className="ml-auto flex gap-1">
                <button className="btn-ghost btn-sm h-7 w-7 p-0" disabled={cur === 0} onClick={() => { const xs = [...d.blocks]; [xs[cur - 1], xs[cur]] = [xs[cur], xs[cur - 1]]; setD({ ...d, blocks: xs }); setCur(cur - 1); }} aria-label="前へ"><ArrowUp size={12} /></button>
                <button className="btn-ghost btn-sm h-7 w-7 p-0" disabled={cur === d.blocks.length - 1} onClick={() => { const xs = [...d.blocks]; [xs[cur + 1], xs[cur]] = [xs[cur], xs[cur + 1]]; setD({ ...d, blocks: xs }); setCur(cur + 1); }} aria-label="後へ"><ArrowDown size={12} /></button>
                <button className="btn-ghost btn-sm h-7 w-7 p-0 text-rose-600" onClick={() => { setD({ ...d, blocks: d.blocks.filter((_, j) => j !== cur) }); setCur(0); }} aria-label="部品を消す"><Trash2 size={12} /></button>
              </span>
            )}
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            <label className="text-[11.5px] text-zinc-500">key<input className="input mt-0.5 font-mono text-[12px]" value={b.key} disabled={ro} aria-label="部品の key" onChange={(e) => setBlock(cur, { key: e.target.value })} /></label>
            <label className="text-[11.5px] text-zinc-500">見出し<input className="input mt-0.5 text-[12.5px]" value={b.label} disabled={ro} aria-label="部品の見出し" onChange={(e) => setBlock(cur, { label: e.target.value })} /></label>
            <label className="text-[11.5px] text-zinc-500">書き方の説明<input className="input mt-0.5 text-[12.5px]" value={b.hint} disabled={ro} aria-label="部品の説明" onChange={(e) => setBlock(cur, { hint: e.target.value })} /></label>
          </div>
          {b.kind === "table" && (
            <div className="mt-2 space-y-1">
              <div className="text-[11.5px] font-medium text-zinc-600">列</div>
              {(b.columns ?? []).map((c, j) => (
                <div key={j} className="flex flex-wrap items-center gap-1.5">
                  <input className="input h-7 w-28 font-mono text-[11.5px]" value={c.key} disabled={ro} aria-label="列の key" onChange={(e) => setBlock(cur, { columns: b.columns!.map((x, k) => (k === j ? { ...x, key: e.target.value } : x)) })} />
                  <input className="input h-7 w-40 text-[12px]" value={c.label} disabled={ro} aria-label="列の見出し" onChange={(e) => setBlock(cur, { columns: b.columns!.map((x, k) => (k === j ? { ...x, label: e.target.value } : x)) })} />
                  <select className="input h-7 w-auto text-[12px]" value={c.kind} disabled={ro} aria-label="列の種類" onChange={(e) => setBlock(cur, { columns: b.columns!.map((x, k) => (k === j ? { ...x, kind: e.target.value as "text" | "number" } : x)) })}>
                    <option value="text">文字</option><option value="number">数値</option>
                  </select>
                  <input className="input h-7 flex-1 text-[12px]" value={c.options.join("、")} disabled={ro} placeholder="選択肢（、で区切る）" aria-label="列の選択肢" onChange={(e) => setBlock(cur, { columns: b.columns!.map((x, k) => (k === j ? { ...x, options: e.target.value.split(/[、,]/).map((o) => o.trim()).filter(Boolean) } : x)) })} />
                  {!ro && <button className="text-zinc-400 hover:text-rose-600" onClick={() => setBlock(cur, { columns: b.columns!.filter((_, k) => k !== j) })} aria-label="列を消す"><Trash2 size={12} /></button>}
                </div>
              ))}
              {!ro && <button className="btn-ghost btn-sm" onClick={() => setBlock(cur, { columns: [...(b.columns ?? []), { key: `col${(b.columns?.length ?? 0) + 1}`, label: "列", kind: "text", options: [] }] })}><Plus size={11} />列を足す</button>}
              <label className="block text-[11.5px] text-zinc-500">行の見出しを固定する（1行に1つ。空なら自由に行を足す）
                <textarea className="input mt-0.5 text-[12px]" rows={2} value={(b.rows ?? []).join("\n")} disabled={ro} aria-label="固定する行" onChange={(e) => setBlock(cur, { rows: e.target.value.split("\n").filter((x) => x.trim()) })} />
              </label>
            </div>
          )}
          {b.kind === "matrix" && (
            <div className="mt-2 grid gap-1.5 md:grid-cols-2">
              {["左上", "右上", "左下", "右下"].map((pos, j) => (
                <label key={pos} className="text-[11.5px] text-zinc-500">{pos}の象限<input className="input mt-0.5 text-[12px]" value={b.quadrants?.[j] ?? ""} disabled={ro} aria-label={`${pos}の象限`} onChange={(e) => { const q = [...(b.quadrants ?? ["", "", "", ""])]; q[j] = e.target.value; setBlock(cur, { quadrants: q }); }} /></label>
              ))}
            </div>
          )}
          {(b.kind === "matrix" || b.kind === "positioning") && (
            <div className="mt-2 grid gap-1.5 md:grid-cols-2">
              {(["x", "y"] as const).map((a) => (
                <div key={a} className="flex items-center gap-1 text-[11.5px] text-zinc-500">{a === "x" ? "横軸" : "縦軸"}
                  {(["label", "low", "high"] as const).map((k) => (
                    <input key={k} className="input h-7 w-24 text-[12px]" placeholder={{ label: "名前", low: "低い側", high: "高い側" }[k]} disabled={ro} aria-label={`${a === "x" ? "横軸" : "縦軸"}の${{ label: "名前", low: "低い側", high: "高い側" }[k]}`}
                      value={b.axes?.[a]?.[k] ?? ""} onChange={(e) => setBlock(cur, { axes: { ...(b.axes ?? { x: { label: "", low: "", high: "" }, y: { label: "", low: "", high: "" } }), [a]: { ...(b.axes?.[a] ?? { label: "", low: "", high: "" }), [k]: e.target.value } } })} />
                  ))}
                </div>
              ))}
            </div>
          )}
          {b.kind === "diagram" && (
            <label className="mt-2 block text-[11.5px] text-zinc-500">ノードの種類（、で区切る。例：自社、顧客、パートナー）
              <input className="input mt-0.5 text-[12px]" value={(b.node_kinds ?? []).join("、")} disabled={ro} aria-label="ノードの種類" onChange={(e) => setBlock(cur, { node_kinds: e.target.value.split(/[、,]/).map((x) => x.trim()).filter(Boolean) })} />
            </label>
          )}
        </div>
      )}
      {canEdit && (
        <div className="flex items-center gap-2">
          <button className="btn-primary btn-sm" disabled={pending || !d.id || !d.name || !d.blocks.length} onClick={save}><Save size={12} />保存する</button>
          {!isNew && fw.source !== "builtin" && <button className="btn-secondary btn-sm" disabled={pending} onClick={del}><Trash2 size={12} />{fw.source === "override" ? "標準に戻す" : "消す"}</button>}
          {err && <span className="text-[12px] text-rose-600">{err}</span>}
        </div>
      )}
    </section>
  );
}

// 12 列の格子：部品をドラッグで動かし、右下の角で大きさを変える
function Grid({ blocks, cur, setCur, ro, onLayout }: { blocks: BlockDef[]; cur: number; setCur: (i: number) => void; ro: boolean; onLayout: (i: number, l: BlockDef["layout"]) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const ROW = 56;
  const rows = Math.max(3, ...blocks.map((b) => b.layout.y + b.layout.h)) + 1;
  const drag = (i: number, mode: "move" | "size") => (e: React.PointerEvent) => {
    if (ro) return;
    e.preventDefault(); e.stopPropagation(); setCur(i);
    const box = ref.current!.getBoundingClientRect();
    const col = box.width / 12;
    const start = { x: e.clientX, y: e.clientY, l: { ...blocks[i].layout } };
    const move = (ev: PointerEvent) => {
      const dx = Math.round((ev.clientX - start.x) / col), dy = Math.round((ev.clientY - start.y) / ROW);
      const l = { ...start.l };
      if (mode === "move") { l.x = Math.max(0, Math.min(12 - l.w, start.l.x + dx)); l.y = Math.max(0, start.l.y + dy); }
      else { l.w = Math.max(1, Math.min(12 - l.x, start.l.w + dx)); l.h = Math.max(1, Math.min(6, start.l.h + dy)); }
      onLayout(i, l);
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  return (
    <div ref={ref} className="relative rounded-lg border border-dashed border-zinc-300 bg-[linear-gradient(to_right,#f4f4f5_1px,transparent_1px)] bg-[length:calc(100%/12)_100%]" style={{ height: rows * ROW }} aria-label="部品の配置">
      {blocks.map((b, i) => (
        <div key={i} onPointerDown={drag(i, "move")} onClick={() => setCur(i)} role="button" aria-label={`部品 ${b.label}`}
          className={`absolute overflow-hidden rounded-md border p-1.5 text-[11.5px] ${TONE[b.kind]} ${i === cur ? "ring-2 ring-brand-500" : ""} ${ro ? "" : "cursor-move"}`}
          style={{ left: `calc(${(b.layout.x / 12) * 100}% + 2px)`, width: `calc(${(b.layout.w / 12) * 100}% - 4px)`, top: b.layout.y * ROW + 2, height: b.layout.h * ROW - 4 }}>
          <div className="truncate font-semibold">{b.label}</div>
          <div className="text-[10px] text-zinc-500">{b.kind}・{b.layout.w}列×{b.layout.h}段</div>
          {!ro && <span onPointerDown={drag(i, "size")} className="absolute bottom-0 right-0 h-3 w-3 cursor-se-resize bg-zinc-400/60" aria-label="大きさを変える" />}
        </div>
      ))}
    </div>
  );
}
