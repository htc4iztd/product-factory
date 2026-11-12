"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2 } from "lucide-react";

const ACCEPT = ".pdf,.docx,.xlsx,.xlsm,.pptx,.md,.txt,.csv";

// 資料（PDF・Word・Excel・PowerPoint・テキスト）を上げて記事にする。複数選べる（1つずつ順に読む）
export function FileAdd({ n }: { n: number }) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<{ name: string; ok: boolean; msg: string }[]>([]);
  const [drag, setDrag] = useState(false);
  const run = async (files: File[]) => {
    if (!files.length || busy) return;
    setLog([]);
    for (const f of files) {
      setBusy(f.name);
      const fd = new FormData();
      fd.set("file", f);
      const r = await fetch(`/api/research/${n}/files`, { method: "POST", body: fd }).catch(() => null);
      const js = r ? await r.json().catch(() => ({})) : {};
      setLog((l) => [...l, r?.ok ? { name: f.name, ok: true, msg: `${js.key} として足しました` } : { name: f.name, ok: false, msg: js.detail ?? "送れませんでした" }]);
    }
    setBusy(null);
    router.refresh();
  };
  return (
    <div className="space-y-2">
      <button type="button" aria-label="資料を上げる" disabled={!!busy}
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); run(Array.from(e.dataTransfer.files)); }}
        className={`flex w-full flex-col items-center gap-1 rounded-lg border-2 border-dashed px-4 py-5 text-center ${drag ? "border-brand-500 bg-brand-50" : "border-zinc-300 hover:border-zinc-400"}`}>
        {busy ? <Loader2 size={18} className="animate-spin text-zinc-500" /> : <FileUp size={18} className="text-zinc-500" />}
        <span className="text-[13px] text-zinc-700">{busy ? `「${busy}」を読んでいます…（要約とファクトを付けています）` : "PDF・Word・Excel・PowerPoint・テキストをドロップ、または押して選ぶ"}</span>
        <span className="text-[11px] text-zinc-400">.pdf .docx .xlsx .pptx .md .txt .csv・1つ 20MB まで・複数可</span>
      </button>
      <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" aria-label="上げる資料"
        onChange={(e) => { run(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      {log.length > 0 && (
        <ul className="space-y-0.5 text-[12px]" aria-live="polite">
          {log.map((x, i) => <li key={i} className={x.ok ? "text-emerald-700" : "text-rose-600"}>{x.name}：{x.msg}</li>)}
        </ul>
      )}
    </div>
  );
}
