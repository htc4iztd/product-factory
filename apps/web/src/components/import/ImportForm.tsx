"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Upload } from "lucide-react";
import type { StageSummary } from "@/lib/agent";

// 資料を選び（またはドロップし）、入れ方と割り当て先の工程を決めて送る
export function ImportForm({ pid, stages }: { pid: string; stages: StageSummary[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"propose" | "fill">("propose");
  const [only, setOnly] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!file) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("mode", mode);
    fd.set("stages", only.join(","));
    const res = await fetch(`/api/p/${pid}/imports`, { method: "POST", body: fd });
    const body = await res.json().catch(() => ({ detail: "送れませんでした" }));
    setBusy(false);
    if (!res.ok) return setError(String(body.detail ?? "送れませんでした"));
    setFile(null);
    router.push(`/p/${pid}/import?doc=${body.id}`);
    router.refresh();
  }

  return (
    <div className="card space-y-4 p-5">
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}
        onClick={() => input.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition ${over ? "border-brand-400 bg-brand-50" : "border-zinc-300 hover:bg-zinc-50"}`}>
        <FileSpreadsheet size={26} className="text-brand-600" />
        {file ? (
          <div className="text-[13px]"><span className="font-medium">{file.name}</span><span className="ml-2 text-zinc-500">{(file.size / 1024).toFixed(0)} KB</span></div>
        ) : (
          <div className="text-[13px] text-zinc-600">Excel・Word・PowerPoint（.xlsx .docx .pptx）かテキスト（.md .txt .csv）をドロップ、または押して選ぶ</div>
        )}
        <input ref={input} type="file" aria-label="取り込む資料" accept=".xlsx,.xlsm,.docx,.pptx,.md,.txt,.csv" className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>
      <fieldset className="space-y-1.5 text-[13px]">
        <legend className="label">入れ方</legend>
        <label className="flex items-start gap-2"><input type="radio" name="mode" checked={mode === "propose"} onChange={() => setMode("propose")} className="mt-1" />
          <span><span className="font-medium">AI の案として出す</span><span className="block text-[12px] text-zinc-500">各工程の対話に「資料の取り込み」として案が並びます。採用したものだけが入ります。</span></span></label>
        <label className="flex items-start gap-2"><input type="radio" name="mode" checked={mode === "fill"} onChange={() => setMode("fill")} className="mt-1" />
          <span><span className="font-medium">空の項目には直接入れる</span><span className="block text-[12px] text-zinc-500">値がすでにある項目は上書きせず、案として出します。</span></span></label>
      </fieldset>
      <details className="text-[13px]">
        <summary className="cursor-pointer select-none text-zinc-600">割り当て先の工程を絞る（選ばなければ AI が見分けます）</summary>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {stages.filter((s) => s.enabled && !["s12", "s14"].includes(s.id)).map((s) => {
            const on = only.includes(s.id);
            return (
              <button key={s.id} type="button" aria-pressed={on} onClick={() => setOnly((x) => (on ? x.filter((y) => y !== s.id) : [...x, s.id]))}
                className={`rounded-full border px-2.5 py-0.5 text-[12px] ${on ? "border-brand-400 bg-brand-50 text-brand-800" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"}`}>
                {s.no} {s.name}
              </button>
            );
          })}
        </div>
      </details>
      {error && <p className="text-[12px] text-rose-600">{error}</p>}
      <button disabled={!file || busy} onClick={send} className="btn-primary"><Upload size={14} />{busy ? "読み取り中…" : "取り込む"}</button>
    </div>
  );
}
