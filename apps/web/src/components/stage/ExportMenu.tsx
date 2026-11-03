"use client";
import { useEffect, useRef, useState } from "react";
import { Download, FileText, FileType2, Presentation, Printer } from "lucide-react";
import { exportMarkdown, exportPowerPoint, exportWord, type ExportDoc } from "@/lib/exportDoc";

// 工程の成果物を書き出す：Word・PowerPoint・PDF（印刷用のページから保存）・Markdown
export function ExportMenu({ doc, printHref, compact = false }: { doc: ExportDoc; printHref: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const run = async (label: string, fn: () => Promise<void> | void) => {
    setBusy(label); setErr(null);
    try { await fn(); setOpen(false); } catch (e) { setErr(`${label}にできませんでした：${(e as Error).message}`); } finally { setBusy(null); }
  };
  const item = (label: string, sub: string, Icon: typeof FileText, fn: () => Promise<void> | void) => (
    <button role="menuitem" className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-zinc-50 disabled:opacity-50" disabled={!!busy} onClick={() => run(label, fn)}>
      <Icon size={15} className="shrink-0 text-zinc-500" /><span className="flex-1"><span className="block text-[13px] font-medium">{label}</span><span className="block text-[11px] text-zinc-500">{sub}</span></span>
      {busy === label && <span className="text-[11px] text-zinc-400">作成中…</span>}
    </button>
  );
  return (
    <div ref={box} className="relative">
      <button className={compact ? "flex h-9 items-center gap-1 rounded-lg px-2 text-[12px] text-zinc-600 active:bg-zinc-100" : "btn-secondary"} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
        <Download size={14} />書き出す
      </button>
      {open && (
        <div role="menu" aria-label="書き出す形式" className="absolute right-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-pop">
          {item("Word", "見出し・表・リストをそのまま（.docx）", FileText, () => exportWord(doc))}
          {item("PowerPoint", "見出しごとに1枚・表は表のまま（.pptx）", Presentation, () => exportPowerPoint(doc))}
          {item("PDF", "印刷用のページを開き、PDF に保存（図も入る）", Printer, () => { window.open(printHref, "_blank", "noopener"); })}
          {item("Markdown", "そのままの文書（.md）", FileType2, () => exportMarkdown(doc))}
          {err && <p className="px-3 py-1.5 text-[11.5px] text-rose-600">{err}</p>}
        </div>
      )}
    </div>
  );
}
