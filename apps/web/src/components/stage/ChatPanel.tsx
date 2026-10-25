"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowUp, Check, CheckCheck, MessageSquareWarning, Sparkles, X } from "lucide-react";
import type { ChatMsg, FieldSpec, Proposal } from "@/lib/agent";
import { acceptAll, decideProposal, sendChat } from "@/app/(app)/p/[id]/s/[stage]/actions";
import { FieldView } from "./FieldEditor";

type Props = { pid: string; sid: string; chat: ChatMsg[]; fields: FieldSpec[]; prompts: string[]; disabled?: string | null };

function ProposalCard({ p, field, onDecide, busy }: { p: Proposal; field?: FieldSpec; onDecide: (accept: boolean) => void; busy: boolean }) {
  const done = p.status !== "pending";
  return (
    <div className={`rounded-lg border bg-white p-3 ${done ? "border-zinc-200 opacity-60" : "border-brand-200 shadow-card"}`}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="text-[12px] font-semibold text-zinc-800">{field?.label ?? p.field}</span>
        {p.status === "accepted" && <span className="ml-auto flex items-center gap-0.5 text-[11px] text-emerald-600"><Check size={12} />採用</span>}
        {p.status === "rejected" && <span className="ml-auto flex items-center gap-0.5 text-[11px] text-zinc-400"><X size={12} />却下</span>}
      </div>
      {field && <div className="max-h-48 overflow-y-auto text-[12px] text-zinc-700"><FieldView field={field} value={p.value} compact /></div>}
      {p.reason && <div className="mt-1.5 text-[11px] text-zinc-400">理由：{p.reason}</div>}
      {!done && (
        <div className="mt-2 flex gap-1.5">
          <button disabled={busy} onClick={() => onDecide(true)} className="btn-brand btn-sm"><Check size={12} />採用</button>
          <button disabled={busy} onClick={() => onDecide(false)} className="btn-ghost btn-sm">却下</button>
        </div>
      )}
    </div>
  );
}

export function ChatPanel({ pid, sid, chat, fields, prompts, disabled }: Props) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));

  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [chat.length, sent]);

  function send(message: string) {
    if (!message.trim() || pending) return;
    setError(null);
    setSent(message);
    setText("");
    start(async () => {
      const r = await sendChat(pid, sid, message);
      if (r.error) { setError(r.error); setText(message); }
      setSent(null);
    });
  }
  function run(fn: () => Promise<{ error?: string }>) {
    setError(null);
    start(async () => { const r = await fn(); if (r.error) setError(r.error); });
  }

  const quick = ["下書きを作って", "矛盾や抜けを指摘して", ...prompts].slice(0, 5);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-brand-500 to-violet-500 text-white"><Sparkles size={13} /></div>
        <div className="text-[13px] font-semibold">AIと詰める</div>
        <span className="ml-auto text-[11px] text-zinc-400">案は採用するまで反映されません</span>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {chat.length === 0 && !sent && (
          <div className="rounded-xl border border-dashed border-zinc-300 p-4 text-[13px] text-zinc-500">
            考えていることをそのまま書いてください。AIが質問で詰め、項目ごとの書き換え案を出します。
          </div>
        )}
        {chat.map((m) => {
          const open = m.proposals.filter((p) => p.status === "pending");
          if (m.role === "user") {
            return (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-zinc-900 px-3.5 py-2 text-[13px] text-white">{m.text}</div>
              </div>
            );
          }
          if (m.role === "feedback") {
            return (
              <div key={m.id} className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
                <MessageSquareWarning size={15} className="mt-0.5 shrink-0" /><div className="whitespace-pre-wrap">{m.text}</div>
              </div>
            );
          }
          return (
            <div key={m.id} className="space-y-2">
              <div className="flex gap-2">
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-500"><Sparkles size={12} /></div>
                <div className="min-w-0 whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-800">{m.text}</div>
              </div>
              {m.proposals.length > 0 && (
                <div className="ml-8 space-y-2">
                  {open.length > 1 && (
                    <button disabled={pending} onClick={() => run(() => acceptAll(pid, sid, m.id, open.map((p) => p.id)))} className="btn-secondary btn-sm">
                      <CheckCheck size={13} />残り{open.length}件をすべて採用
                    </button>
                  )}
                  {m.proposals.map((p) => (
                    <ProposalCard key={p.id} p={p} field={byKey[p.field]} busy={pending}
                      onDecide={(accept) => run(() => decideProposal(pid, sid, m.id, p.id, accept))} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {sent && (
          <>
            <div className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-zinc-900 px-3.5 py-2 text-[13px] text-white">{sent}</div>
            </div>
            <div className="flex items-center gap-2 text-[13px] text-zinc-400">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-100"><Sparkles size={12} className="animate-pulse" /></div>
              考えています…
            </div>
          </>
        )}
        <div ref={end} />
      </div>

      <div className="border-t border-zinc-200 p-3">
        {error && <p className="mb-2 rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-700">{error}</p>}
        {disabled ? (
          <p className="text-center text-xs text-zinc-400">{disabled}</p>
        ) : (
          <>
            <div className="-mx-3 mb-2 flex gap-1.5 overflow-x-auto px-3 pb-1 [scrollbar-width:none]">
              {quick.map((q) => (
                <button key={q} disabled={pending} onClick={() => send(q)} className="shrink-0 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] text-zinc-600 hover:border-brand-200 hover:text-brand-700">
                  {q}
                </button>
              ))}
            </div>
            <div className="relative">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(text); } }}
                rows={3}
                placeholder="例：対象を共働きの子育て世帯に絞りたい"
                aria-label="AIへの発言"
                className="input resize-none pr-12"
              />
              <button disabled={pending || !text.trim()} onClick={() => send(text)} aria-label="送信" className="btn-brand absolute bottom-2 right-2 h-8 w-8 rounded-lg p-0">
                <ArrowUp size={15} />
              </button>
            </div>
            <div className="mt-1 text-right text-[10px] text-zinc-400"><span className="kbd">⌘</span>+<span className="kbd">Enter</span> で送信</div>
          </>
        )}
      </div>
    </div>
  );
}
