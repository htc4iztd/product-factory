"use client";
import { useRef, useState } from "react";
import { FileText, ImageIcon, Paperclip, X } from "lucide-react";

export type Attached = { id: number; filename: string; kind: "doc" | "image"; chars?: number };

// 対話に添える資料・画像（その発言のときだけエージェントが読む）。クリップ・ドロップ・貼り付けで足す
export function useAttachments(pid: string, agent: string) {
  const [items, setItems] = useState<Attached[]>([]);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);
  async function add(files: FileList | File[]) {
    setError(null);
    for (const f of Array.from(files).slice(0, 5)) {
      setBusy((n) => n + 1);
      const fd = new FormData();
      fd.set("file", f);
      const res = await fetch(`/api/p/${pid}/agents/${agent}/attachments`, { method: "POST", body: fd });
      const body = await res.json().catch(() => ({ detail: "添付できませんでした" }));
      setBusy((n) => n - 1);
      if (!res.ok) { setError(`${f.name}：${body.detail ?? "添付できませんでした"}`); continue; }
      setItems((x) => (x.length >= 5 ? x : [...x, body as Attached]));
    }
  }
  return {
    items, busy: busy > 0, error, add,
    remove: (id: number) => setItems((x) => x.filter((a) => a.id !== id)),
    clear: () => setItems([]),
    // 貼り付けた画像・ファイルを添付にする
    onPaste: (e: React.ClipboardEvent) => {
      const files = Array.from(e.clipboardData.files);
      if (files.length) { e.preventDefault(); void add(files); }
    },
  };
}

export function AttachButton({ a, disabled }: { a: ReturnType<typeof useAttachments>; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" disabled={disabled || a.busy || a.items.length >= 5} onClick={() => input.current?.click()}
        className="btn-ghost btn-sm h-8 w-8 p-0" aria-label="資料・画像を添える" title="資料・画像を添える（その発言のときだけ読みます。貼り付け・ドロップでも）">
        <Paperclip size={15} className={a.busy ? "animate-pulse" : ""} />
      </button>
      <input ref={input} type="file" multiple hidden aria-label="添付するファイル"
        accept=".xlsx,.xlsm,.docx,.pptx,.md,.txt,.csv,.png,.jpg,.jpeg,.webp,.gif"
        onChange={(e) => { if (e.target.files) void a.add(e.target.files); e.target.value = ""; }} />
    </>
  );
}

export function AttachChips({ a }: { a: ReturnType<typeof useAttachments> }) {
  if (!a.items.length && !a.busy && !a.error) return null;
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-1">
      {a.items.map((x) => (
        <span key={x.id} className="flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[11px] text-zinc-700">
          {x.kind === "image" ? <ImageIcon size={11} /> : <FileText size={11} />}
          <span className="max-w-[10rem] truncate">{x.filename}</span>
          <button type="button" onClick={() => a.remove(x.id)} aria-label={`${x.filename}を外す`} className="text-zinc-400 hover:text-zinc-700"><X size={11} /></button>
        </span>
      ))}
      {a.busy && <span className="text-[11px] text-zinc-500">読み込んでいます…</span>}
      {a.error && <span className="text-[11px] text-rose-600">{a.error}</span>}
    </div>
  );
}

// 発言に付いた添付（名前だけ）
export function SentAttachments({ items, dark }: { items: { filename: string; kind: string }[]; dark?: boolean }) {
  if (!items?.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {items.map((x, i) => (
        <span key={i} className={`flex items-center gap-1 rounded px-1 text-[10px] ${dark ? "bg-white/15 text-zinc-200" : "bg-zinc-100 text-zinc-600"}`}>
          {x.kind === "image" ? <ImageIcon size={10} /> : <FileText size={10} />}{x.filename}
        </span>
      ))}
    </div>
  );
}
