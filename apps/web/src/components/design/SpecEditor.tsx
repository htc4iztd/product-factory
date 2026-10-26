"use client";
import { useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import type { ErModel, ProcSpec, Row, SpecCall, SpecIo, SpecParam } from "@/lib/agent";
import { ZoomPan, textWidth, wrapText } from "@/components/ZoomPan";
import { CrudToggle, MiniTable, SaveBar, useEditable } from "./kit";

// 処理仕様（処理ごとの概要・主な処理・入出力・パラメータ・呼び出す部品・設定値）と、
// そこから作る CRUD マトリクス・データフロー図。どれも同じ値（specs）を編集する

const SPEC_KINDS = ["画面", "API", "バッチ", "常駐", "共通部品", "その他"];
const IO_KINDS = ["画面", "テーブル", "ファイル", "外部システム", "API", "メール", "その他"];
const IO_DIRS = ["入力", "出力", "入出力"];
const KIND_STYLE: Record<string, string> = {
  画面: "bg-sky-100 text-sky-800", API: "bg-violet-100 text-violet-800", バッチ: "bg-amber-100 text-amber-800",
  常駐: "bg-orange-100 text-orange-800", 共通部品: "bg-zinc-200 text-zinc-700", その他: "bg-zinc-100 text-zinc-600",
};

const dirOf = (crud: string) => (!crud || crud === "R" ? "入力" : crud.includes("R") ? "入出力" : "出力");
const blankSpec = (n: number): ProcSpec => ({
  id: `PR-${String(n).padStart(2, "0")}`, name: "新しい処理", kind: "API", component: "", trigger: "", fr: "", summary: "",
  steps: [], constraints: "", io: [], params: [], calls: [], settings: [],
});

// テーブルの名前（論理名・物理名）を、概念データモデルのエンティティ名にそろえる
function tableAlias(er: ErModel | undefined) {
  const m = new Map<string, string>();
  for (const e of er?.entities ?? []) for (const k of [e.name, e.physical]) if (k) m.set(k.toLowerCase(), e.name);
  return (name: string) => m.get(name.toLowerCase()) ?? name;
}

export function crudMatrix(specs: ProcSpec[], er: ErModel | undefined) {
  const alias = tableAlias(er);
  const tables = (er?.entities ?? []).map((e) => e.name);
  const rows = specs.map((p) => {
    const cells: Record<string, string> = {};
    for (const x of p.io) {
      if (x.kind !== "テーブル") continue;
      const t = alias(x.name);
      if (!tables.includes(t)) tables.push(t);
      cells[t] = ["C", "R", "U", "D"].filter((c) => (cells[t] ?? "").includes(c) || x.crud.includes(c)).join("");
    }
    return { id: p.id, name: p.name, cells };
  });
  return { tables, rows };
}

export function SpecEditor({ pid, sid, fieldKey, value, er, components, readOnly }: {
  pid: string; sid: string; fieldKey: string; value: ProcSpec[] | undefined; er: ErModel | undefined; components: Row[]; readOnly: boolean;
}) {
  const ed = useEditable<ProcSpec[]>(pid, sid, fieldKey, value ?? EMPTY);
  const [tab, setTab] = useState<"each" | "crud" | "dfd">("each");
  const [idx, setIdx] = useState(0);
  const specs = ed.v;
  const p = specs[Math.min(idx, specs.length - 1)];
  const patch = (fn: (x: ProcSpec) => ProcSpec) => ed.change((all) => all.map((x, i) => (i === Math.min(idx, all.length - 1) ? fn(x) : x)));
  const tabs = [["each", "処理ごと"], ["crud", "CRUD マトリクス"], ["dfd", "全体のデータフロー"]] as const;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="処理仕様の見方">
        {tabs.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-md px-2.5 py-1 text-[12px] font-medium ${tab === k ? "bg-zinc-900 text-white" : "border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"}`}>{l}</button>
        ))}
        <span className="text-[11px] text-zinc-400">処理 {specs.length} 件</span>
        {!readOnly && <span className="ml-auto"><SaveBar e={ed} label="処理仕様を保存" /></span>}
      </div>
      {tab === "crud" && <CrudView specs={specs} er={er} readOnly={readOnly} onChange={(s) => ed.change(() => s)} />}
      {tab === "dfd" && <OverallFlow specs={specs} er={er} />}
      {tab === "each" && (
        <div className="grid gap-3 lg:grid-cols-[220px_1fr]">
          <div className="space-y-1">
            {specs.map((x, i) => (
              <button key={i} onClick={() => setIdx(i)}
                className={`flex w-full items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left text-[12px] ${i === idx ? "border-brand-400 bg-brand-50" : "border-zinc-200 bg-white hover:bg-zinc-50"}`}>
                <span className="font-mono text-[10px] text-zinc-500">{x.id}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{x.name}</span>
                <span className={`shrink-0 rounded px-1 text-[10px] ${KIND_STYLE[x.kind] ?? KIND_STYLE.その他}`}>{x.kind}</span>
              </button>
            ))}
            {!readOnly && (
              <button className="btn-ghost btn-sm w-full" onClick={() => {
                const n = Math.max(0, ...specs.map((x) => Number(x.id.replace(/\D/g, "")) || 0)) + 1;
                ed.change((all) => [...all, blankSpec(n)]);
                setIdx(specs.length);
              }}><Plus size={12} />処理を追加</button>
            )}
            {specs.length === 0 && <p className="px-1 text-[11px] text-zinc-400">処理を追加するか、AI に下書きを頼んでください</p>}
          </div>
          {p && <Detail p={p} er={er} components={components} readOnly={readOnly} patch={patch}
            remove={() => { if (confirm(`「${p.id} ${p.name}」を削除しますか？`)) { ed.change((all) => all.filter((x) => x !== p)); setIdx(0); } }} />}
        </div>
      )}
    </div>
  );
}
const EMPTY: ProcSpec[] = [];

function Detail({ p, er, components, readOnly, patch, remove }: {
  p: ProcSpec; er: ErModel | undefined; components: Row[]; readOnly: boolean; patch: (fn: (x: ProcSpec) => ProcSpec) => void; remove: () => void;
}) {
  const set = <K extends keyof ProcSpec>(k: K, v: ProcSpec[K]) => patch((x) => ({ ...x, [k]: v }));
  const tables = [...(er?.entities ?? []).map((e) => e.name)];
  return (
    <div className="min-w-0 space-y-3 rounded-xl border border-zinc-200 p-3">
      <datalist id="pf-components">{components.map((c) => <option key={String(c.id)} value={String(c.id)}>{String(c.name ?? "")}</option>)}</datalist>
      <datalist id="pf-tables">{tables.map((t) => <option key={t} value={t} />)}</datalist>
      <div className="flex flex-wrap items-end gap-2">
        <span className="mb-2 font-mono text-[12px] text-zinc-500">{p.id}</span>
        <label className="block min-w-[12rem] flex-1"><span className="label">処理名</span>
          <input className="input h-8" value={p.name} readOnly={readOnly} aria-label="処理名" onChange={(e) => set("name", e.target.value)} /></label>
        <label className="block"><span className="label">処理区分</span>
          <select className="input h-8" value={p.kind} disabled={readOnly} aria-label="処理区分" onChange={(e) => set("kind", e.target.value)}>
            {SPEC_KINDS.map((k) => <option key={k}>{k}</option>)}
          </select></label>
        <label className="block w-36"><span className="label">コンポーネント</span>
          <input className="input h-8" list="pf-components" value={p.component} readOnly={readOnly} placeholder="CP-01 / クラス名" onChange={(e) => set("component", e.target.value)} /></label>
        <label className="block w-40"><span className="label">起動</span>
          <input className="input h-8" value={p.trigger} readOnly={readOnly} placeholder="例：毎日 2:00" onChange={(e) => set("trigger", e.target.value)} /></label>
        <label className="block w-28"><span className="label">機能要求</span>
          <input className="input h-8" value={p.fr} readOnly={readOnly} placeholder="FR-01" onChange={(e) => set("fr", e.target.value)} /></label>
        {!readOnly && <button className="btn-ghost btn-sm mb-0.5 text-zinc-400 hover:text-rose-600" onClick={remove} aria-label="この処理を削除"><Trash2 size={12} /></button>}
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <div className="space-y-2">
          <label className="block"><span className="label">処理の概要</span>
            <textarea className="input text-[12px]" rows={2} value={p.summary} readOnly={readOnly} aria-label="処理の概要" onChange={(e) => set("summary", e.target.value)} /></label>
          <Steps steps={p.steps} readOnly={readOnly} onChange={(s) => set("steps", s)} />
          <label className="block"><span className="label">制限・前提</span>
            <textarea className="input text-[12px]" rows={2} value={p.constraints} readOnly={readOnly} onChange={(e) => set("constraints", e.target.value)} /></label>
        </div>
        <div>
          <span className="label">データフロー（入出力から自動で描きます）</span>
          <SpecFlow p={p} />
        </div>
      </div>
      <Section title="入出力（テーブルは CRUD）">
        <MiniTable<SpecIo> readOnly={readOnly} rows={p.io} addLabel="入出力を追加"
          blank={() => ({ dir: "入力", kind: "テーブル", name: "", crud: "R", format: "", note: "" })}
          onChange={(io) => set("io", io.map((x) => (x.kind === "テーブル" ? { ...x, dir: dirOf(x.crud) } : { ...x, crud: "" })))}
          cols={[{ key: "kind", label: "種類", kind: "select", options: IO_KINDS, width: "7rem" }, { key: "name", label: "名前", list: "pf-tables" },
            { key: "crud", label: "CRUD", kind: "crud", width: "8rem" }, { key: "dir", label: "向き", kind: "select", options: IO_DIRS, width: "5.5rem" },
            { key: "format", label: "形式" }, { key: "note", label: "説明" }]} />
      </Section>
      <Section title="パラメータ（リクエスト・レスポンス）">
        <MiniTable<SpecParam> readOnly={readOnly} rows={p.params} addLabel="パラメータを追加" empty="なし"
          blank={() => ({ dir: "リクエスト", name: "", label: "", type: "", required: "任意", note: "" })}
          onChange={(v) => set("params", v)}
          cols={[{ key: "dir", label: "区分", kind: "select", options: ["リクエスト", "レスポンス"], width: "6.5rem" }, { key: "name", label: "物理名" },
            { key: "label", label: "項目名" }, { key: "type", label: "型", width: "6rem" },
            { key: "required", label: "必須", kind: "select", options: ["必須", "任意"], width: "4.5rem" }, { key: "note", label: "説明" }]} />
      </Section>
      <div className="grid gap-3 xl:grid-cols-2">
        <Section title="呼び出す部品（クラス・メソッド）">
          <MiniTable<SpecCall> readOnly={readOnly} rows={p.calls} addLabel="部品を追加" empty="なし"
            blank={() => ({ name: "", cls: "", method: "", args: "" })} onChange={(v) => set("calls", v)}
            cols={[{ key: "name", label: "部品" }, { key: "cls", label: "クラス・モジュール" }, { key: "method", label: "メソッド" }, { key: "args", label: "引数" }]} />
        </Section>
        <Section title="使う設定値">
          <MiniTable<{ key: string; note: string }> readOnly={readOnly} rows={p.settings} addLabel="設定値を追加" empty="なし"
            blank={() => ({ key: "", note: "" })} onChange={(v) => set("settings", v)}
            cols={[{ key: "key", label: "キー" }, { key: "note", label: "用途" }]} />
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><div className="mb-1 text-[12px] font-medium text-zinc-600">{title}</div>{children}</div>;
}

// 主な処理：番号つきの縦の流れ。行ごとに書き換え・並べ替え
function Steps({ steps, onChange, readOnly }: { steps: string[]; onChange: (s: string[]) => void; readOnly: boolean }) {
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    const s = [...steps];
    [s[i], s[j]] = [s[j], s[i]];
    onChange(s);
  };
  return (
    <div>
      <span className="label">主な処理（順に）</span>
      <ol className="space-y-1">
        {steps.map((s, i) => (
          <li key={i} className="group flex items-start gap-1.5">
            <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[10px] font-bold text-white">{i + 1}</span>
            <textarea className="input field-sizing-content min-h-0 resize-none py-1 text-[12px]" rows={1} value={s} readOnly={readOnly} aria-label={`手順${i + 1}`}
              onChange={(e) => onChange(steps.map((x, j) => (j === i ? e.target.value : x)))} />
            {!readOnly && (
              <span className="flex shrink-0 opacity-30 group-hover:opacity-100">
                <button onClick={() => move(i, -1)} className="btn-ghost btn-sm h-7 w-6 p-0" aria-label="上へ"><ArrowUp size={11} /></button>
                <button onClick={() => move(i, 1)} className="btn-ghost btn-sm h-7 w-6 p-0" aria-label="下へ"><ArrowDown size={11} /></button>
                <button onClick={() => onChange(steps.filter((_, j) => j !== i))} className="btn-ghost btn-sm h-7 w-6 p-0" aria-label="手順を削除"><X size={11} /></button>
              </span>
            )}
          </li>
        ))}
      </ol>
      {!readOnly && <button className="btn-ghost btn-sm mt-1" onClick={() => onChange([...steps, ""])}><Plus size={12} />手順を追加</button>}
    </div>
  );
}

// ---------- データフロー図（SVG） ----------
const BOX_W = 150, BOX_H = 40;

function Shape({ kind, x, y, w = BOX_W, h = BOX_H, label, sub }: { kind: string; x: number; y: number; w?: number; h?: number; label: string; sub?: string }) {
  const { lines } = wrapText(label, 11, 2);
  const text = (
    <>
      {lines.map((l, i) => <text key={i} x={x + w / 2} y={y + h / 2 + (i - (lines.length - 1) / 2) * 12 + (sub ? -2 : 4)} textAnchor="middle" fontSize="10.5" fontWeight="600" fill="#27272a">{l}</text>)}
      {sub && <text x={x + w / 2} y={y + h - 5} textAnchor="middle" fontSize="8.5" fill="#71717a">{sub}</text>}
      <title>{label}</title>
    </>
  );
  if (kind === "テーブル") {
    return (
      <g>
        <path d={`M${x},${y + 6} v${h - 12} a${w / 2},6 0 0 0 ${w},0 v-${h - 12}`} fill="#fef3c7" stroke="#d97706" />
        <ellipse cx={x + w / 2} cy={y + 6} rx={w / 2} ry={6} fill="#fde68a" stroke="#d97706" />
        {text}
      </g>
    );
  }
  if (kind === "ファイル") {
    return <g><path d={`M${x},${y} h${w - 12} l12,12 v${h - 12} h-${w} z`} fill="#f4f4f5" stroke="#71717a" />{text}</g>;
  }
  if (kind === "画面") {
    return <g><rect x={x} y={y} width={w} height={h} rx={4} fill="#e0f2fe" stroke="#0284c7" /><rect x={x} y={y} width={w} height={7} rx={3} fill="#0284c7" />{text}</g>;
  }
  if (kind === "外部システム" || kind === "API") {
    return <g><rect x={x} y={y} width={w} height={h} rx={h / 2} fill="#ede9fe" stroke="#7c3aed" strokeDasharray={kind === "API" ? "" : "4 2"} />{text}</g>;
  }
  if (kind === "メール") {
    return <g><rect x={x} y={y} width={w} height={h} rx={3} fill="#fce7f3" stroke="#db2777" /><path d={`M${x},${y} l${w / 2},${h / 2.4} l${w / 2},-${h / 2.4}`} fill="none" stroke="#f9a8d4" />{text}</g>;
  }
  if (kind === "処理") {
    return <g><rect x={x} y={y} width={w} height={h} rx={10} fill="#4f46e5" />{lines.map((l, i) => <text key={i} x={x + w / 2} y={y + h / 2 + (i - (lines.length - 1) / 2) * 13 + 4} textAnchor="middle" fontSize="11.5" fontWeight="700" fill="#fff">{l}</text>)}<title>{label}</title></g>;
  }
  return <g><rect x={x} y={y} width={w} height={h} rx={4} fill="#fff" stroke="#a1a1aa" />{text}</g>;
}

function Arrow({ x1, y1, x2, y2, both, label }: { x1: number; y1: number; x2: number; y2: number; both?: boolean; label?: string }) {
  const mx = (x1 + x2) / 2;
  return (
    <g>
      <path d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke="#71717a" strokeWidth="1.2"
        markerEnd="url(#pf-arrow)" markerStart={both ? "url(#pf-arrow-s)" : undefined} />
      {label && <text x={x2 > x1 ? x2 - 14 : x1 - 14} y={(x2 > x1 ? y2 : y1) - 4} textAnchor="end" fontSize="9" fontWeight="700" fill="#52525b">{label}</text>}
    </g>
  );
}

function Markers() {
  return (
    <defs>
      <marker id="pf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#71717a" /></marker>
      <marker id="pf-arrow-s" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M10,0 L0,5 L10,10 z" fill="#71717a" /></marker>
    </defs>
  );
}

// 1つの処理：入力を左、出力を右、呼び出す部品を下に置く
function SpecFlow({ p }: { p: ProcSpec }) {
  const ins = p.io.filter((x) => x.dir === "入力");
  const outs = p.io.filter((x) => x.dir !== "入力");
  const rows = Math.max(ins.length, outs.length, 1);
  const gap = 54, top = 16;
  const H = Math.max(140, top + rows * gap + (p.calls.length ? 80 : 10));
  const W = 560, cx = W / 2 - 80, cy = top + (rows * gap) / 2 - 30;
  const y = (i: number, n: number) => top + ((rows - n) * gap) / 2 + i * gap;
  if (!p.io.length && !p.calls.length) return <div className="flex h-36 items-center justify-center rounded-lg border border-dashed border-zinc-200 text-[12px] text-zinc-400">入出力を足すと図になります</div>;
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-1">
      <ZoomPan width={W} height={H} label={`${p.name}のデータフロー`}>
        <Markers />
        {ins.map((x, i) => (
          <g key={`i${i}`}>
            <Shape kind={x.kind} x={10} y={y(i, ins.length)} label={x.name} sub={x.kind === "テーブル" ? x.crud : x.kind} />
            <Arrow x1={10 + BOX_W} y1={y(i, ins.length) + BOX_H / 2} x2={cx} y2={cy + 30} label={x.kind === "テーブル" ? x.crud : ""} />
          </g>
        ))}
        <Shape kind="処理" x={cx} y={cy} w={160} h={60} label={`${p.id} ${p.name}`} />
        {outs.map((x, i) => (
          <g key={`o${i}`}>
            <Shape kind={x.kind} x={W - BOX_W - 10} y={y(i, outs.length)} label={x.name} sub={x.kind === "テーブル" ? x.crud : x.kind} />
            <Arrow x1={cx + 160} y1={cy + 30} x2={W - BOX_W - 10} y2={y(i, outs.length) + BOX_H / 2} both={x.dir === "入出力"} label={x.kind === "テーブル" ? x.crud : ""} />
          </g>
        ))}
        {p.calls.map((c, i) => {
          const w = Math.min(130, Math.max(80, textWidth(c.cls || c.name, 9) + 16));
          const x = cx + 80 - (p.calls.length * 140) / 2 + i * 140 + (140 - w) / 2;
          const yy = H - 46;
          return (
            <g key={`c${i}`}>
              <line x1={cx + 80} y1={cy + 60} x2={x + w / 2} y2={yy} stroke="#a1a1aa" strokeDasharray="3 2" markerEnd="url(#pf-arrow)" />
              <rect x={x} y={yy} width={w} height={34} rx={4} fill="#fff" stroke="#a1a1aa" />
              <text x={x + w / 2} y={yy + 14} textAnchor="middle" fontSize="9.5" fontWeight="600" fill="#3f3f46">{wrapText(c.name || c.cls, 12, 1).lines[0]}</text>
              <text x={x + w / 2} y={yy + 27} textAnchor="middle" fontSize="8.5" fill="#71717a">{wrapText(`${c.cls}${c.method ? `.${c.method}` : ""}`, 20, 1).lines[0]}</text>
              <title>{`${c.name} ${c.cls}.${c.method}(${c.args})`}</title>
            </g>
          );
        })}
      </ZoomPan>
    </div>
  );
}

// 全体：処理を真ん中に、テーブルを右、画面・外部などを左に置き、入出力で結ぶ
function OverallFlow({ specs, er }: { specs: ProcSpec[]; er: ErModel | undefined }) {
  const alias = tableAlias(er);
  const key = (x: SpecIo) => `${x.kind}:${x.kind === "テーブル" ? alias(x.name) : x.name}`;
  const right: { k: string; kind: string; name: string }[] = [], left: typeof right = [];
  for (const p of specs) for (const x of p.io) {
    const k = key(x);
    const side = x.kind === "テーブル" || x.kind === "ファイル" ? right : left;
    if (!right.some((r) => r.k === k) && !left.some((r) => r.k === k)) side.push({ k, kind: x.kind, name: x.kind === "テーブル" ? alias(x.name) : x.name });
  }
  if (!specs.length) return <p className="text-[12px] text-zinc-400">処理がありません</p>;
  const gap = 56, top = 16;
  const n = Math.max(left.length, right.length, specs.length);
  const H = top * 2 + n * gap, W = 820;
  const pos = (i: number, len: number) => top + ((n - len) * gap) / 2 + i * gap;
  const yL = Object.fromEntries(left.map((x, i) => [x.k, pos(i, left.length) + BOX_H / 2]));
  const yR = Object.fromEntries(right.map((x, i) => [x.k, pos(i, right.length) + BOX_H / 2]));
  const PX = W / 2 - 85, PW = 170;
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-2">
      <ZoomPan width={W} height={Math.max(H, 160)} label="全体のデータフロー">
        <Markers />
        {specs.map((p, i) => {
          const py = pos(i, specs.length);
          return (
            <g key={p.id}>
              {p.io.map((x, j) => {
                const k = key(x);
                if (k in yL) return x.dir === "出力"
                  ? <Arrow key={j} x1={PX} y1={py + 20} x2={10 + BOX_W} y2={yL[k]} />
                  : <Arrow key={j} x1={10 + BOX_W} y1={yL[k]} x2={PX} y2={py + 20} both={x.dir === "入出力"} />;
                return x.dir === "入力"
                  ? <Arrow key={j} x1={W - BOX_W - 10} y1={yR[k]} x2={PX + PW} y2={py + 20} label={x.crud} />
                  : <Arrow key={j} x1={PX + PW} y1={py + 20} x2={W - BOX_W - 10} y2={yR[k]} both={x.dir === "入出力"} label={x.crud} />;
              })}
              <Shape kind="処理" x={PX} y={py} w={PW} h={BOX_H} label={`${p.id} ${p.name}`} />
            </g>
          );
        })}
        {left.map((x, i) => <Shape key={x.k} kind={x.kind} x={10} y={pos(i, left.length)} label={x.name} sub={x.kind} />)}
        {right.map((x, i) => <Shape key={x.k} kind={x.kind} x={W - BOX_W - 10} y={pos(i, right.length)} label={x.name} sub={x.kind} />)}
      </ZoomPan>
    </div>
  );
}

// ---------- CRUD マトリクス ----------
function CrudView({ specs, er, readOnly, onChange }: { specs: ProcSpec[]; er: ErModel | undefined; readOnly: boolean; onChange: (s: ProcSpec[]) => void }) {
  const { tables, rows } = crudMatrix(specs, er);
  const alias = tableAlias(er);
  const setCell = (i: number, t: string, crud: string) => onChange(specs.map((p, j) => {
    if (j !== i) return p;
    const hit = p.io.findIndex((x) => x.kind === "テーブル" && alias(x.name) === t);
    const rest = p.io.filter((x, k) => !(x.kind === "テーブル" && alias(x.name) === t) || k === hit);
    if (!crud) return { ...p, io: rest.filter((x) => !(x.kind === "テーブル" && alias(x.name) === t)) };
    if (hit < 0) return { ...p, io: [...p.io, { dir: dirOf(crud), kind: "テーブル", name: t, crud, format: "", note: "" }] };
    return { ...p, io: rest.map((x) => (x.kind === "テーブル" && alias(x.name) === t ? { ...x, crud, dir: dirOf(crud) } : x)) };
  }));
  // 作る処理のないテーブル・読む処理のないテーブルは見直しどころ
  const noC = tables.filter((t) => !rows.some((r) => (r.cells[t] ?? "").includes("C")));
  const noR = tables.filter((t) => !rows.some((r) => (r.cells[t] ?? "").includes("R")));
  if (!tables.length || !rows.length) return <p className="text-[12px] text-zinc-400">概念データモデルのエンティティと処理を作ると、処理 × テーブルの表になります</p>;
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-xl border border-zinc-200">
        <table className="border-collapse text-[12px]">
          <thead className="bg-zinc-50">
            <tr>
              <th className="sticky left-0 z-10 min-w-[14rem] bg-zinc-50 px-2 py-1.5 text-left font-medium text-zinc-500">処理 ＼ テーブル</th>
              {tables.map((t) => (
                <th key={t} className={`min-w-[7rem] border-l border-zinc-100 px-2 py-1.5 text-center font-medium ${noC.includes(t) || noR.includes(t) ? "text-amber-700" : "text-zinc-600"}`}>{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className="border-t border-zinc-100">
                <td className="sticky left-0 z-10 bg-white px-2 py-1"><span className="mr-1 font-mono text-[10px] text-zinc-500">{r.id}</span>{r.name}</td>
                {tables.map((t) => (
                  <td key={t} className="border-l border-zinc-100 px-1">
                    <CrudToggle compact value={r.cells[t] ?? ""} readOnly={readOnly} onChange={(v) => setCell(i, t, v)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(noC.length > 0 || noR.length > 0) && (
        <div className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-[12px] text-amber-900">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <div>
            {noC.length > 0 && <div>作る（C）処理がないテーブル：{noC.join("、")}</div>}
            {noR.length > 0 && <div>読む（R）処理がないテーブル：{noR.join("、")}</div>}
          </div>
        </div>
      )}
      <p className="text-[11px] text-zinc-400">C=登録・R=参照・U=更新・D=削除。マスの文字を押すと、その処理の入出力に反映されます。</p>
    </div>
  );
}
