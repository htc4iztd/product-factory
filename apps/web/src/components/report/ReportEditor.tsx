"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Download, FileDown, Plus, RefreshCw, RotateCcw, Save, Trash2 } from "lucide-react";
import type { ProductReport, ReportSlide } from "@/lib/agent";
import { deleteReport, regenerateReport, saveReport } from "@/app/(app)/p/[id]/reports/actions";

const FONT = "Meiryo";
const INK = "18181B", SUB = "71717A", ACC = "4F46E5", LINE = "E4E4E7";

// できた構成を1枚ずつ直し、PowerPoint・Markdown にする
export function ReportEditor({ pid, r, product, stageNames }: { pid: string; r: ProductReport; product: string; stageNames: Record<string, string> }) {
  const initial = useMemo(() => structuredClone(r.data?.slides ?? []), [r.data]);
  const [slides, setSlides] = useState<ReportSlide[]>(initial);
  const [title, setTitle] = useState(r.title);
  const [summary, setSummary] = useState(r.data?.summary ?? "");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => { setSlides(initial); setSummary(r.data?.summary ?? ""); setTitle(r.title); setDirty(false); }, [initial, r.data?.summary, r.title]);

  const patch = (i: number, p: Partial<ReportSlide>) => { setSlides((x) => x.map((s, j) => (j === i ? { ...s, ...p } : s))); setDirty(true); };
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= slides.length) return;
    setSlides((x) => { const y = [...x]; [y[i], y[j]] = [y[j], y[i]]; return y; });
    setDirty(true);
  };
  const save = () => start(async () => {
    const res = await saveReport(pid, r.number, title, slides.map((s) => ({ ...s, bullets: s.bullets.filter((b) => b.trim()) })), summary);
    if (res.error) setError(res.error); else { setDirty(false); setError(null); }
  });

  async function pptx() {
    const { default: PptxGenJS } = await import("pptxgenjs");
    const p = new PptxGenJS();
    p.layout = "LAYOUT_WIDE";
    const today = new Date().toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" });
    const cover = p.addSlide();
    cover.addShape(p.ShapeType.rect, { x: 0, y: 0, w: 0.25, h: 7.5, fill: { color: ACC }, line: { color: ACC } });
    cover.addText(title, { x: 0.8, y: 2.3, w: 11.8, h: 1.1, fontFace: FONT, fontSize: 32, bold: true, color: INK });
    cover.addText([product, r.audience && `読み手：${r.audience}`, today].filter(Boolean).join("　"), { x: 0.8, y: 3.45, w: 11.8, h: 0.5, fontFace: FONT, fontSize: 14, color: SUB });
    if (summary) cover.addText(summary, { x: 0.8, y: 4.2, w: 11.5, h: 1.8, fontFace: FONT, fontSize: 13, color: INK, valign: "top" });
    slides.forEach((s, i) => {
      const sl = p.addSlide();
      sl.addText(s.title, { x: 0.5, y: 0.3, w: 12.3, h: 0.9, fontFace: FONT, fontSize: s.kind === "table" ? 18 : 22, bold: true, color: INK, valign: "top" });
      if (s.kind === "table" && s.table) {
        const head = s.table.head.map((t) => ({ text: t, options: { bold: true, color: SUB, fill: { color: "F4F4F5" } } }));
        sl.addTable([head, ...s.table.rows.map((row) => row.map((t) => ({ text: t })))],
          { x: 0.5, y: 1.3, w: 12.3, fontFace: FONT, fontSize: 9, color: INK, border: { type: "solid", color: LINE, pt: 0.5 }, autoPage: false });
      } else {
        if (s.message) sl.addText(s.message, { x: 0.5, y: 1.25, w: 12.3, h: 0.5, fontFace: FONT, fontSize: 14, color: ACC, bold: true });
        sl.addText(s.bullets.filter((b) => b.trim()).map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
          { x: 0.6, y: 2.0, w: 12.1, h: 4.6, fontFace: FONT, fontSize: 16, color: INK, valign: "top", paraSpaceAfter: 10 });
      }
      const src = s.sources.map((x) => stageNames[x] ?? x).join("・");
      sl.addText(`${src ? `出典：${src}　` : ""}${i + 2}`, { x: 0.5, y: 7.0, w: 12.3, h: 0.3, fontFace: FONT, fontSize: 9, color: SUB, align: "right" });
      if (s.notes) sl.addNotes(s.notes);
    });
    await p.writeFile({ fileName: `${title}.pptx` });
  }

  function markdown() {
    const md = [`# ${title}`, "", [product, r.audience && `読み手：${r.audience}`].filter(Boolean).join("・"), "", summary, ""];
    for (const s of slides) {
      md.push(`## ${s.title}`, "");
      if (s.message) md.push(`**${s.message}**`, "");
      if (s.kind === "table" && s.table) {
        md.push(`| ${s.table.head.join(" | ")} |`, `|${"---|".repeat(s.table.head.length)}`, ...s.table.rows.map((row) => `| ${row.map((c) => c.replace(/\|/g, "／")).join(" | ")} |`), "");
      } else md.push(...s.bullets.filter((b) => b.trim()).map((b) => `- ${b}`), "");
      if (s.sources.length) md.push(`出典：${s.sources.map((x) => stageNames[x] ?? x).join("・")}`, "");
    }
    const url = URL.createObjectURL(new Blob([md.join("\n")], { type: "text/markdown" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${title}.md` });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <input className="input h-9 min-w-[16rem] flex-1 text-[15px] font-semibold" value={title} aria-label="報告資料の題" onChange={(e) => { setTitle(e.target.value); setDirty(true); }} />
        <button onClick={save} disabled={!dirty || pending} className="btn-primary btn-sm"><Save size={12} />{pending ? "保存中…" : "保存"}</button>
        <button onClick={() => { setSlides(initial); setTitle(r.title); setSummary(r.data?.summary ?? ""); setDirty(false); }} disabled={!dirty} className="btn-ghost btn-sm" aria-label="変更を取り消す"><RotateCcw size={12} /></button>
        <span className="mx-1 h-5 w-px bg-zinc-200" />
        <button onClick={pptx} disabled={!slides.length} className="btn-secondary btn-sm"><Download size={12} />PowerPointに出力</button>
        <button onClick={markdown} disabled={!slides.length} className="btn-secondary btn-sm"><FileDown size={12} />Markdownに出力</button>
        <button onClick={() => { if (confirm("選んだ範囲の今の中身で作り直します。直した内容は失われます。")) start(async () => { await regenerateReport(pid, r.number); }); }} className="btn-ghost btn-sm"><RefreshCw size={12} />作り直す</button>
        <button onClick={() => { if (confirm(`${r.key} を削除しますか？`)) start(async () => { await deleteReport(pid, r.number); }); }} className="btn-ghost btn-sm text-zinc-400 hover:text-rose-600" aria-label="報告資料を削除"><Trash2 size={12} /></button>
        {dirty && <span className="w-full text-right text-[11px] text-amber-600">保存していない変更があります</span>}
        {error && <span className="w-full text-[11px] text-rose-600">{error}</span>}
      </div>
      <div className="card p-4">
        <span className="label">要約（表紙に載ります）</span>
        <textarea className="input text-[13px]" rows={2} value={summary} aria-label="要約" onChange={(e) => { setSummary(e.target.value); setDirty(true); }} />
      </div>
      <ol className="grid gap-4 2xl:grid-cols-2">
        {slides.map((s, i) => (
          <li key={i} className="group">
            <div className="mb-1 flex items-center gap-1 text-[11px] text-zinc-500">
              <span className="font-mono">{i + 2}</span>
              <span className={`rounded px-1 ${s.kind === "table" ? "bg-zinc-100" : "bg-brand-50 text-brand-700"}`}>{s.kind === "table" ? "付録の表" : "本文"}</span>
              {s.sources.map((x) => <span key={x} className="rounded bg-zinc-100 px-1">{stageNames[x] ?? x}</span>)}
              <span className="ml-auto flex opacity-40 group-hover:opacity-100">
                <button onClick={() => move(i, -1)} className="btn-ghost btn-sm h-6 w-6 p-0" aria-label="前へ"><ArrowUp size={11} /></button>
                <button onClick={() => move(i, 1)} className="btn-ghost btn-sm h-6 w-6 p-0" aria-label="後ろへ"><ArrowDown size={11} /></button>
                <button onClick={() => { setSlides((x) => x.filter((_, j) => j !== i)); setDirty(true); }} className="btn-ghost btn-sm h-6 w-6 p-0" aria-label="このスライドを削除"><Trash2 size={11} /></button>
              </span>
            </div>
            <div className="aspect-[16/9] overflow-hidden rounded-xl border border-zinc-200 bg-white p-[3.5%] shadow-card">
              <input className="w-full border-0 bg-transparent p-0 text-[17px] font-bold text-zinc-900 outline-none focus:bg-brand-50/40" value={s.title} aria-label={`スライド${i + 2}の題`} onChange={(e) => patch(i, { title: e.target.value })} />
              {s.kind === "table" && s.table ? (
                <div className="mt-2 max-h-[80%] overflow-auto">
                  <table className="w-full border-collapse text-[10px]">
                    <thead><tr>{s.table.head.map((h, k) => <th key={k} className="border border-zinc-200 bg-zinc-50 px-1 py-0.5 text-left font-medium text-zinc-500">{h}</th>)}</tr></thead>
                    <tbody>{s.table.rows.map((row, k) => <tr key={k}>{row.map((c, m) => <td key={m} className="border border-zinc-200 px-1 py-0.5">{c}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              ) : (<>
                <input className="mt-1 w-full border-0 bg-transparent p-0 text-[13px] font-semibold text-brand-700 outline-none focus:bg-brand-50/40" value={s.message} placeholder="一言のメッセージ" aria-label={`スライド${i + 2}のメッセージ`} onChange={(e) => patch(i, { message: e.target.value })} />
                <textarea className="mt-2 h-[65%] w-full resize-none border-0 bg-transparent p-0 text-[13px] leading-6 text-zinc-800 outline-none focus:bg-brand-50/40"
                  value={s.bullets.map((b) => `・${b}`).join("\n")} aria-label={`スライド${i + 2}の本文`}
                  onChange={(e) => patch(i, { bullets: e.target.value.split("\n").map((x) => x.replace(/^\s*[・\-*]\s?/, "")) })} />
              </>)}
            </div>
            {s.kind !== "table" && (
              <input className="input mt-1 h-7 py-0 text-[11px]" value={s.notes} placeholder="話すときのメモ（ノートに入ります）" aria-label={`スライド${i + 2}のメモ`} onChange={(e) => patch(i, { notes: e.target.value })} />
            )}
          </li>
        ))}
      </ol>
      <button className="btn-ghost btn-sm" onClick={() => { setSlides((x) => [...x, { kind: "content", title: "新しいスライド", message: "", bullets: [""], sources: [], notes: "" }]); setDirty(true); }}>
        <Plus size={12} />スライドを足す
      </button>
    </div>
  );
}
