"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Check, MessageSquarePlus, Send, Sparkles, X } from "lucide-react";
import { generateProto, saveProto, type Proto, type ProtoComment } from "@/app/(app)/p/[id]/s/[stage]/ui/actions";
import { sendAssistant } from "@/lib/assistant-actions";
import { withBridge } from "@/lib/protoBridge";

const STATUS_JA: Record<ProtoComment["status"], string> = { open: "コメント", sent: "AI に依頼中", applied: "反映済み", resolved: "解決" };
type Pick = { target: string; label: string; context: string };

// スマホのプロトタイプ：画面いっぱいに 390px で動かす。「コメント」で部品を押すと、下からコメントの欄が出る。AI に送ると直した版の承認依頼が届く
export function MobileProto({ pid, proto, me, readOnly }: { pid: string; proto: Proto | null; me: string; readOnly: boolean }) {
  const [html, setHtml] = useState(proto?.html ?? "");
  const [comments, setComments] = useState<ProtoComment[]>(proto?.comments ?? []);
  const [commenting, setCommenting] = useState(false);
  const [pick, setPick] = useState<Pick | null>(null);
  const [list, setList] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const frame = useRef<HTMLIFrameElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(390);
  useEffect(() => { setHtml(proto?.html ?? ""); setComments(proto?.comments ?? []); }, [proto?.html, proto?.comments]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { const el = area.current; if (!el) return; const f = () => setW(el.clientWidth); f(); const ro = new ResizeObserver(f); ro.observe(el); return () => ro.disconnect(); }, [html]);
  const scale = Math.min(1, w / 390);
  const doc = useMemo(() => (html ? withBridge(html) : ""), [html]);
  const pins = useMemo(() => comments.map((c, i) => ({ id: c.id, n: i + 1, target: c.target, context: c.context, status: c.status, text: c.text })), [comments]);
  const tell = (m: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ pf: 1, ...m }, "*");
  useEffect(() => { tell({ type: "mode", on: commenting }); }, [commenting]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { tell({ type: "pins", pins }); }, [pins]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const d = e.data as { pf?: number; type?: string; target?: string; label?: string; context?: string };
      if (d?.pf !== 1) return;
      if (d.type === "ready") { tell({ type: "mode", on: commenting }); tell({ type: "pins", pins }); }
      if (d.type === "pin") setList(true);
      if (d.type === "pick" && d.target !== undefined && !readOnly) setPick({ target: d.target, label: d.label ?? "", context: d.context ?? "" });
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = async (next: ProtoComment[], note: string) => {
    const r = await saveProto(pid, { comments: next });
    if (r.error) { setToast(r.error); return; }
    if (r.proto) setComments(r.proto.comments);
    setToast(note);
  };
  const ask = async (c: ProtoComment): Promise<ProtoComment> => {
    const text = `【プロトタイプへのコメント】${c.context ? `画面「${c.context}」の` : ""}${c.label}（位置 ${c.target || "全体"}）について：${c.text}\nこの部分だけを直してください。`;
    const r = await sendAssistant(`/p/${pid}/s/s06/ui?mode=proto`, text, [], []);
    if (r.error) { setToast(`AI に送れませんでした：${r.error}`); return c; }
    return { ...c, status: "sent", msg_id: r.reply?.id ?? null };
  };
  const add = (text: string, toAi: boolean) => pick && start(async () => {
    let c: ProtoComment = { id: `c${Date.now().toString(36)}`, ...pick, text, status: "open", x: 0, y: 0, by: me, at: new Date().toISOString(), msg_id: null };
    if (toAi) c = await ask(c);
    setPick(null); setCommenting(false);
    await persist([...comments, c], c.status === "sent" ? "AI に送りました。チャットに承認依頼が届きます" : "コメントを残しました");
  });

  if (!html) {
    return (
      <div className="space-y-3 px-5 py-10 text-center text-[14px] text-zinc-600">
        <p className="font-semibold text-zinc-800">まだプロトタイプがありません</p>
        <p>⑥の画面一覧・ユーザーフローから、AI に作らせられます。できたらチャットに承認依頼が届きます。</p>
        {!readOnly && <button className="btn-primary mx-auto justify-center px-5 py-2.5" disabled={pending} onClick={() => start(async () => { const r = await generateProto(pid, "スマホで触る前提で"); setToast(r.error ?? "AI が書いています（1〜3分）"); })}><Sparkles size={15} />AI で作る</button>}
        {toast && <p className="text-[12px] text-zinc-500">{toast}</p>}
      </div>
    );
  }
  const open = comments.filter((c) => c.status === "open" || c.status === "sent").length;
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-100 px-3 py-1.5">
        <button className="text-[13px] text-zinc-600" onClick={() => setList(true)}>コメント {comments.length}{open > 0 && <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-[11px] text-amber-800">未反映 {open}</span>}</button>
        {!readOnly && <button className={`ml-auto flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-medium ${commenting ? "bg-amber-500 text-white" : "bg-zinc-100 text-zinc-800"}`} aria-pressed={commenting} onClick={() => { setCommenting((x) => !x); setPick(null); }}>
          <MessageSquarePlus size={14} />{commenting ? "部品を押す" : "コメント"}</button>}
      </div>
      <div ref={area} className="relative min-h-0 flex-1 bg-zinc-100" style={{ overflow: "clip" }}>
        <iframe ref={frame} key={doc.length + html.slice(-60)} title="プロトタイプの画面" sandbox="allow-scripts" srcDoc={doc}
          className="block border-0 bg-white" style={{ width: 390, height: `calc(100% / ${scale})`, transform: `scale(${scale})`, transformOrigin: "0 0" }} />
        {toast && <div role="status" className="absolute inset-x-4 bottom-3 rounded-xl bg-zinc-900 px-3 py-2 text-[13px] text-white">{toast}</div>}
      </div>
      {pick && <CommentSheet pick={pick} pending={pending} onCancel={() => setPick(null)} onSubmit={add} />}
      {list && (
        <div className="fixed inset-0 z-40 flex flex-col bg-black/30" onClick={(e) => { if (e.target === e.currentTarget) setList(false); }}>
          <div className="mt-auto max-h-[70dvh] overflow-y-auto rounded-t-2xl bg-white p-3 pb-6" role="dialog" aria-label="コメントの一覧">
            <div className="mb-2 flex items-center"><span className="text-[14px] font-semibold">コメント</span><button className="ml-auto p-2" onClick={() => setList(false)} aria-label="閉じる"><X size={18} /></button></div>
            {comments.length === 0 && <p className="py-4 text-[13px] text-zinc-400">「コメント」を押してから画面の部品を押すと、コメントを付けられます。</p>}
            <ol className="space-y-2">
              {comments.map((c, i) => (
                <li key={c.id} className="rounded-xl border border-zinc-200 p-2.5 text-[13px]">
                  <div className="flex items-center gap-1.5 text-[11px] text-zinc-500"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-[10px] text-white">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{c.context ? `${c.context}／` : ""}{c.label}</span><span className="shrink-0 rounded bg-zinc-100 px-1.5">{STATUS_JA[c.status]}</span></div>
                  <p className="mt-1 whitespace-pre-wrap">{c.text}</p>
                  {!readOnly && c.status !== "resolved" && (
                    <div className="mt-1.5 flex gap-1.5">
                      {c.status === "open" && <button className="btn-secondary btn-sm" disabled={pending} onClick={() => start(async () => { const n = await ask(c); if (n.status === "sent") await persist(comments.map((x) => (x.id === c.id ? n : x)), "AI に送りました"); })}><Send size={12} />AI に送る</button>}
                      <button className="btn-ghost btn-sm" disabled={pending} onClick={() => start(() => persist(comments.map((x) => (x.id === c.id ? { ...x, status: "resolved" as const } : x)), "解決にしました"))}><Check size={12} />解決</button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}

function CommentSheet({ pick, pending, onCancel, onSubmit }: { pick: Pick; pending: boolean; onCancel: () => void; onSubmit: (text: string, toAi: boolean) => void }) {
  const [text, setText] = useState("");
  const [toAi, setToAi] = useState(true);
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black/30" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="mt-auto rounded-t-2xl bg-white p-4 pb-[max(16px,env(safe-area-inset-bottom))]" role="dialog" aria-label="コメントを書く">
        <div className="mb-2 flex items-center text-[12px] text-zinc-500"><span className="min-w-0 flex-1 truncate">{pick.context ? `${pick.context}／` : ""}{pick.label}</span>
          <button onClick={onCancel} aria-label="やめる" className="p-1"><X size={16} /></button></div>
        <textarea autoFocus className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-[16px]" rows={3} value={text} onChange={(e) => setText(e.target.value)} aria-label="コメント" placeholder="例：このボタンをもっと目立たせて" />
        <label className="mt-2 flex items-center gap-2 text-[14px]"><input type="checkbox" className="h-4 w-4" checked={toAi} onChange={(e) => setToAi(e.target.checked)} />AI（設計PM）に送って直してもらう</label>
        <button className="btn-primary mt-3 w-full justify-center py-2.5" disabled={pending || !text.trim()} onClick={() => onSubmit(text.trim(), toAi)}>{toAi ? <><Send size={14} />送る</> : "残す"}</button>
      </div>
    </div>
  );
}
