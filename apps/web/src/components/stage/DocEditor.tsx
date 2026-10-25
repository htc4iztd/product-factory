"use client";
import { useState, useTransition } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CheckCircle2, Info, Pencil } from "lucide-react";
import type { FieldSpec } from "@/lib/agent";
import { setMarkdown } from "@/app/(app)/p/[id]/s/[stage]/actions";

// 文書タブ。Markdown で書いた内容を「## 項目名」ごとにフレームワークの項目へ反映する
export function DocEditor({ pid, sid, markdown, fields, readOnly }: { pid: string; sid: string; markdown: string; fields: FieldSpec[]; readOnly: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(markdown);
  const [result, setResult] = useState<{ changed: string[]; notes: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const label = Object.fromEntries(fields.map((f) => [f.key, f.label]));

  function save() {
    setError(null);
    start(async () => {
      const r = await setMarkdown(pid, sid, text);
      if (r.error) return setError(r.error);
      setResult({ changed: r.changed ?? [], notes: r.notes ?? [] });
      setEditing(false);
    });
  }

  if (!editing) {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        {result && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-[13px] text-emerald-900">
            <div className="flex items-center gap-2 font-medium"><CheckCircle2 size={14} />
              {result.changed.length ? `${result.changed.length}項目に反映しました：${result.changed.map((k) => label[k] ?? k).join("・")}` : "変わった項目はありませんでした"}
            </div>
            {result.notes.length > 0 && <ul className="mt-1 list-disc pl-6 text-xs text-amber-800">{result.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
          </div>
        )}
        <div className="card relative p-8">
          {!readOnly && (
            <button onClick={() => { setText(markdown); setEditing(true); setResult(null); }} className="btn-secondary btn-sm absolute right-4 top-4"><Pencil size={12} />文書を編集</button>
          )}
          <div className="prose-md"><Markdown remarkPlugins={[remarkGfm]}>{markdown}</Markdown></div>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-brand-50/60 px-4 py-2.5 text-xs text-brand-900">
        <Info size={14} />
        <span>「## 項目名」の見出しごとに、キャンバスの項目へ反映します。箇条書きは「- 」、表は「|」区切りで書きます。見出しを消した項目は変わりません。</span>
        <div className="ml-auto flex gap-2">
          <button onClick={() => setEditing(false)} className="btn-ghost btn-sm">やめる</button>
          <button disabled={pending} onClick={save} className="btn-primary btn-sm">{pending ? "反映中…" : "キャンバスに反映"}</button>
        </div>
      </div>
      {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
      <div className="grid gap-4 xl:grid-cols-2">
        <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label="文書（Markdown）"
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); } }}
          className="input h-[70vh] resize-none font-mono text-[12px] leading-6" />
        <div className="card h-[70vh] overflow-y-auto p-6">
          <div className="section-title mb-2">プレビュー</div>
          <div className="prose-md"><Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown></div>
        </div>
      </div>
    </div>
  );
}
