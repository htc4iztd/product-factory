"use client";
import { useState, useTransition } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DocDetail } from "@/lib/agent";
import { saveDoc } from "@/app/(app)/p/[id]/team-actions";

export function DocForm({ pid, doc }: { pid: string; doc: DocDetail }) {
  const [title, setTitle] = useState(doc.title);
  const [body, setBody] = useState(doc.body);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = title !== doc.title || body !== doc.body;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="タイトル" className="input max-w-md font-medium" />
        <button disabled={!dirty || pending} className="btn-primary btn-sm"
          onClick={() => start(async () => { const r = await saveDoc(pid, doc.number, title, body); setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: "保存しました" }); })}>
          {pending ? "保存中…" : "保存"}
        </button>
        {msg && <span className={`text-xs ${msg.ok ? "text-emerald-600" : "text-rose-600"}`}>{msg.text}</span>}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <textarea value={body} onChange={(e) => { setBody(e.target.value); setMsg(null); }} aria-label="本文（Markdown）"
          className="input min-h-[60vh] font-mono text-[12px] leading-relaxed" placeholder="# 見出し&#10;本文を Markdown で書きます" />
        <div className="card prose-md overflow-y-auto p-5"><Markdown remarkPlugins={[remarkGfm]}>{body || "_（プレビュー）_"}</Markdown></div>
      </div>
    </div>
  );
}
