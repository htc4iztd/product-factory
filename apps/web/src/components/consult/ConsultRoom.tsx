"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, BookOpen, ClipboardCheck, FilePenLine, Plus, Sparkles, Trash2 } from "lucide-react";
import type { AssistantMsg } from "@/lib/agent";
import { Feed } from "@/components/assistant/AssistantShell";
import { Avatar } from "@/components/rail/Avatar";
import { useChatSend } from "@/components/chat/LiveTurn";
import { addConsultNote, dropConsultNote, type ConsultView } from "@/app/(app)/p/[id]/s/[stage]/consult/actions";

const START = "相談を始めたい。この工程をゼロから磨き上げるには、どこから考えるとよいか。問いを立てて導いてほしい";
const DRAFT = "ここまでの合意メモをもとに、この工程の項目の下書きを提案して";

// 工程の担当（その分野の専門家）との相談の部屋：左に対話、右に合意メモと担当の知識
export function ConsultRoom({ pid, sid, initial, readOnly }: { pid: string; sid: string; initial: ConsultView; readOnly: boolean }) {
  const [view, setView] = useState(initial);
  const router = useRouter();
  const path = `/p/${pid}/s/${sid}/consult`;
  const load = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    const r = await fetch(`/api/p/${pid}/consult/${sid}`, { cache: "no-store" }).catch(() => null);
    if (r?.ok) setView(await r.json());
  }, [pid, sid]);
  useEffect(() => { const t = setInterval(load, 4000); return () => clearInterval(t); }, [load]);
  const chat = useChatSend((mine, reply) => {
    setView((v) => ({ ...v, thread: [...v.thread.filter((x) => x.id !== mine.id && x.id !== reply.id), mine, reply].sort((a, b) => a.id - b.id) }));
    load();
  });
  const changed = (m: AssistantMsg) => { setView((v) => ({ ...v, thread: v.thread.map((x) => (x.id === m.id ? m : x)) })); load(); router.refresh(); };
  const send = (text: string) => chat.send({ path, text, mentions: [], attachments: [] });
  const empty = view.thread.length === 0 && !chat.live;
  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_340px] overflow-hidden rounded-xl border border-zinc-200 bg-white" aria-label="担当との相談">
      <section className="flex min-h-0 flex-col">
        {empty ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
            <Avatar k={sid} size={64} />
            <div>
              <div className="text-[17px] font-semibold">{view.agent.name}に相談する</div>
              <p className="mt-1 max-w-md text-[13px] text-zinc-500">この分野の専門家として、問いを立てて導き、選択肢と根拠を出します。決めたことは合意メモに残り、担当が下書きを作るときの土台になります。</p>
            </div>
            {!readOnly && <button className="btn-primary px-5 py-2.5" disabled={!!chat.live} onClick={() => send(START)}><Sparkles size={15} />相談を始める</button>}
          </div>
        ) : (
          <Feed msgs={view.thread} live={chat.live} onChanged={changed} />
        )}
        {!readOnly && <Composer busy={!!chat.live} onSend={send} name={view.agent.name} />}
      </section>
      <aside className="flex min-h-0 flex-col border-l border-zinc-200 bg-zinc-50/50">
        <Notes pid={pid} sid={sid} notes={view.notes} readOnly={readOnly} busy={!!chat.live} onChanged={load} onDraft={() => send(DRAFT)} />
        {view.knowledge.length > 0 && (
          <details className="border-t border-zinc-200 px-4 py-3 text-[12px]">
            <summary className="flex cursor-pointer items-center gap-1.5 font-semibold text-zinc-700"><BookOpen size={13} />{view.agent.name}が持っている知識</summary>
            <ul className="mt-2 space-y-0.5 text-zinc-600">{view.knowledge.map((k) => <li key={k}>・{k}</li>)}</ul>
          </details>
        )}
      </aside>
    </div>
  );
}

function Notes({ pid, sid, notes, readOnly, busy, onChanged, onDraft }: {
  pid: string; sid: string; notes: ConsultView["notes"]; readOnly: boolean; busy: boolean; onChanged: () => void; onDraft: () => void;
}) {
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 px-4 pb-1 pt-3 text-[13px] font-semibold"><ClipboardCheck size={14} className="text-emerald-600" />合意メモ（{notes.length}）</div>
      <p className="px-4 text-[11px] text-zinc-500">相談で決めたこと。担当が下書きを作るときに必ず読みます。</p>
      <ol className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 py-2" aria-label="合意メモ">
        {notes.length === 0 && <li className="text-[12px] text-zinc-400">まだありません。相談の中で決めたことは、担当が「合意メモに残す」承認依頼にします。</li>}
        {notes.map((n, i) => (
          <li key={n.id} className="pf-rise group flex gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-[12.5px]">
            <span className="mt-0.5 shrink-0 font-mono text-[10.5px] text-zinc-400">{i + 1}</span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap">{n.text}</span>
            {!readOnly && <button className="shrink-0 text-zinc-300 opacity-0 hover:text-rose-600 group-hover:opacity-100" aria-label="合意メモを消す" disabled={pending}
              onClick={() => start(async () => { const r = await dropConsultNote(pid, sid, n.id); setErr(r.error ?? null); onChanged(); })}><Trash2 size={13} /></button>}
          </li>
        ))}
      </ol>
      {!readOnly && (
        <div className="space-y-2 border-t border-zinc-200 px-4 py-3">
          <div className="flex gap-1.5">
            <input className="input h-8 flex-1 text-[12px]" value={text} onChange={(e) => setText(e.target.value)} placeholder="自分で決めたことを書き足す" aria-label="合意メモを足す" />
            <button className="btn-secondary btn-sm h-8" disabled={pending || !text.trim()} aria-label="合意メモに足す"
              onClick={() => start(async () => { const r = await addConsultNote(pid, sid, text); setErr(r.error ?? null); if (!r.error) setText(""); onChanged(); })}><Plus size={13} /></button>
          </div>
          <button className="btn-primary btn-sm w-full justify-center" disabled={busy || notes.length === 0} onClick={onDraft}><FilePenLine size={13} />合意メモから下書きを作ってもらう</button>
          {err && <p className="text-[11.5px] text-rose-600">{err}</p>}
        </div>
      )}
    </div>
  );
}

function Composer({ busy, onSend, name }: { busy: boolean; onSend: (t: string) => Promise<string | null>; name: string }) {
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const el = box.current; if (!el) return; el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 180)}px`; }, [text]);
  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setText(""); setErr(null);
    const e = await onSend(t);
    if (e) { setErr(e); setText(t); }
  };
  return (
    <div className="border-t border-zinc-200 px-4 py-3" aria-label="相談の入力">
      {err && <p className="mb-1 text-[12px] text-rose-600">{err}</p>}
      <div className="flex items-end gap-2 rounded-2xl border border-zinc-300 bg-white px-3 py-2 focus-within:border-zinc-500">
        <textarea ref={box} rows={1} value={text} onChange={(e) => setText(e.target.value)} aria-label="相談に話す"
          placeholder={busy ? `${name}が書いています…` : `${name}に相談する（Enter で送る・Shift+Enter で改行）`}
          className="max-h-[180px] min-h-6 flex-1 resize-none bg-transparent text-[14px] leading-6 outline-none"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
        <button className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white disabled:bg-zinc-300" aria-label="相談を送る" disabled={busy || !text.trim()} onClick={send}><ArrowUp size={16} /></button>
      </div>
    </div>
  );
}
