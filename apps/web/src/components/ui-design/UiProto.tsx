"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Check, Code2, Download, FileUp, Layers, Maximize2, MessageSquarePlus, Send, Smartphone, Sparkles, Trash2, X } from "lucide-react";
import { generateProto, saveProto, type Proto, type ProtoComment } from "@/app/(app)/p/[id]/s/[stage]/ui/actions";
import { sendAssistant } from "@/lib/assistant-actions";
import { assembleProto, type ProtoPage, type ProtoScreen } from "@/lib/protoAssemble";
import { withBridge } from "@/lib/protoBridge";

const MAX = 1_500_000;
const STATUS_JA: Record<ProtoComment["status"], { label: string; tone: string }> = {
  open: { label: "コメント", tone: "bg-amber-100 text-amber-800" },
  sent: { label: "AI に依頼中", tone: "bg-sky-100 text-sky-800" },
  applied: { label: "反映済み", tone: "bg-emerald-100 text-emerald-800" },
  resolved: { label: "解決", tone: "bg-zinc-100 text-zinc-500" },
};
const SOURCE_JA: Record<string, string> = { assembled: "画面からまとめたもの", ai: "AI が書いたもの", import: "取り込んだもの", edit: "手で直したもの" };
type Pick = { target: string; label: string; context: string; left: number; top: number };
type Panel = "comments" | "make" | "code";

// ⑥のプロトタイプ：画面の移り方まで操作できる、1つの HTML。隔離した枠（別オリジン・script だけ許す）で動かす。
// 作る（画面からまとめる・AI で作る・取り込む）・触る・コメントを付けて AI に直させる・コードを直す・ダウンロード
export function UiProto({ pid, product, proto, pages, screens, flows, readOnly, me }: {
  pid: string; product: string; proto: Proto | null; pages: ProtoPage[]; screens: ProtoScreen[]; flows: ProtoScreen[]; readOnly: boolean; me: string;
}) {
  const [html, setHtml] = useState(proto?.html ?? "");
  const [comments, setComments] = useState<ProtoComment[]>(proto?.comments ?? []);
  const [source, setSource] = useState(proto?.source ?? "");
  const [panel, setPanel] = useState<Panel>(proto?.html ? "comments" : "make");
  const [commenting, setCommenting] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [pick, setPick] = useState<Pick | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const frame = useRef<HTMLIFrameElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ w: 900, h: 700 });
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const f = () => setFit({ w: el.clientWidth, h: el.clientHeight });
    f();
    const ro = new ResizeObserver(f);
    ro.observe(el);
    return () => ro.disconnect();
  }, [html]);
  // 広い画面は 1000px で描いて、枠に収まるよう縮める（狭い枠でも、案内＋端末の配置のまま見える）。スマホは 390px
  const logical = narrow ? 390 : Math.max(1000, fit.w);
  const scale = Math.min(1, fit.w / logical);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  // チャットの承認などで外から変わったら読み直す
  useEffect(() => { setHtml(proto?.html ?? ""); setComments(proto?.comments ?? []); setSource(proto?.source ?? ""); }, [proto?.html, proto?.comments, proto?.source]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }, [toast]);
  // チャットで頼むときにプロトタイプを開いていると伝わるよう、URL に mode=proto を付けておく
  useEffect(() => {
    const u = new URL(window.location.href);
    if (u.searchParams.get("mode") !== "proto") { u.searchParams.set("mode", "proto"); window.history.replaceState(window.history.state, "", u.toString()); }
  }, []);

  const doc = useMemo(() => (html ? withBridge(html) : ""), [html]);
  const tell = useCallback((m: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ pf: 1, ...m }, "*"), []);
  const pins = useMemo(() => comments.map((c, i) => ({ id: c.id, n: i + 1, target: c.target, context: c.context, status: c.status, text: c.text })), [comments]);
  useEffect(() => { tell({ type: "mode", on: commenting }); }, [commenting, tell]);
  useEffect(() => { tell({ type: "pins", pins, active }); }, [pins, active, tell]);
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const d = e.data as { pf?: number; type?: string; id?: string; target?: string; label?: string; context?: string; rect?: { left: number; bottom: number } };
      if (d?.pf !== 1) return;
      if (d.type === "ready") { tell({ type: "mode", on: commenting }); tell({ type: "pins", pins, active }); }
      if (d.type === "pin" && d.id) { setActive(d.id); setPanel("comments"); }
      if (d.type === "pick" && d.target !== undefined && !readOnly) {
        const k = scaleRef.current;
        setPick({ target: d.target, label: d.label ?? "", context: d.context ?? "", left: (d.rect?.left ?? 20) * k, top: ((d.rect?.bottom ?? 20) + 6) * k });
        setActive(null);
      }
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [commenting, pins, active, readOnly, tell]);

  const persist = (body: { html?: string; comments?: ProtoComment[]; source?: string }, note?: string) => new Promise<boolean>((resolve) => {
    start(async () => {
      const r = await saveProto(pid, body);
      if (r.error) { setToast(r.error); resolve(false); return; }
      if (r.proto) { setHtml(r.proto.html); setComments(r.proto.comments); setSource(r.proto.source); }
      if (note) setToast(note);
      resolve(true);
    });
  });
  const replace = async (next: string, src: string, note: string) => {
    if (html && !confirm("いまのプロトタイプを置き換えます。よいですか？（コメントは残ります）")) return;
    if (await persist({ html: next, source: src }, note)) setPanel("comments");
  };
  const askAi = async (c: ProtoComment): Promise<ProtoComment> => {
    const where = c.context ? `画面「${c.context}」の` : "";
    const text = `【プロトタイプへのコメント】${where}${c.label}（位置 ${c.target || "全体"}）について：${c.text}\nこの部分だけを直してください。`;
    const r = await sendAssistant(`/p/${pid}/s/s06/ui?mode=proto`, text, [], []);
    if (r.error) { setToast(`AI に送れませんでした：${r.error}`); return c; }
    return { ...c, status: "sent", msg_id: r.reply?.id ?? null };
  };
  const addComment = (text: string, toAi: boolean) => {
    if (!pick || !text.trim()) return;
    start(async () => {
      let c: ProtoComment = { id: `c${Date.now().toString(36)}`, target: pick.target, label: pick.label, context: pick.context, text: text.trim(), status: "open", x: 0, y: 0, by: me, at: new Date().toISOString(), msg_id: null };
      if (toAi) c = await askAi(c);
      setPick(null); setActive(c.id); setPanel("comments");
      await persist({ comments: [...comments, c] }, c.status === "sent" ? "AI（設計PM）に送りました。右のチャットに直した版の承認依頼が届きます" : "コメントを残しました");
    });
  };
  const update = (id: string, fn: (c: ProtoComment) => ProtoComment | null, note?: string) =>
    persist({ comments: comments.map((c) => (c.id === id ? fn(c) : c)).filter((c): c is ProtoComment => c !== null) }, note);
  const sendLater = (c: ProtoComment) => start(async () => { const n = await askAi(c); if (n.status === "sent") await update(c.id, () => n, "AI（設計PM）に送りました"); });
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    a.download = `${product || "prototype"}-モックアップ.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const open = comments.filter((c) => c.status !== "resolved").length;
  const tab = (k: Panel, label: string, Icon: typeof Layers) => (
    <button role="tab" aria-selected={panel === k} onClick={() => setPanel(k)} className={`flex flex-1 items-center justify-center gap-1 py-2 ${panel === k ? "border-b-2 border-zinc-900 font-semibold" : "text-zinc-500"}`}><Icon size={12} />{label}</button>
  );

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_300px] overflow-hidden rounded-xl border border-zinc-200 bg-white" aria-label="プロトタイプ">
      <section className="flex min-h-0 min-w-0 flex-col bg-zinc-100">
        <div className="flex items-center gap-1 border-b border-zinc-200 bg-white px-3 py-1.5">
          <span className="truncate text-[12px] text-zinc-500">{html ? `${SOURCE_JA[source] ?? ""}・${Math.round(html.length / 1000)}KB` : "まだありません"}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1">
            <button className={`rounded-md px-2 py-1.5 ${!narrow ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`} aria-pressed={!narrow} aria-label="広い画面" title="広い画面" onClick={() => setNarrow(false)}><Maximize2 size={13} /></button>
            <button className={`rounded-md px-2 py-1.5 ${narrow ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`} aria-pressed={narrow} aria-label="スマホの幅" title="スマホの幅（390px）" onClick={() => setNarrow(true)}><Smartphone size={13} /></button>
            {html && <button className="btn-ghost btn-sm h-7 px-1.5" onClick={download} aria-label="HTML をダウンロード" title="HTML をダウンロード"><Download size={14} /></button>}
            {!readOnly && html && (
              <button className={`ml-1 flex items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1 text-[12px] font-medium ${commenting ? "bg-amber-500 text-white" : "border border-zinc-200 text-zinc-700 hover:bg-zinc-50"}`}
                aria-pressed={commenting} title="コメント中は、画面の部品を押すとコメントを付けられます" onClick={() => { setCommenting((x) => !x); setPick(null); }}>
                <MessageSquarePlus size={13} />{commenting ? "コメント中" : "コメント"}</button>
            )}
          </span>
        </div>
        <div ref={area} className="relative min-h-0 flex-1" style={{ overflow: "clip" }}>
          {html ? (
            <div className="relative mx-auto h-full bg-white" style={{ width: logical * scale, overflow: "clip" }}>
              <iframe ref={frame} key={doc.length + html.slice(-60)} title="プロトタイプの画面" sandbox="allow-scripts" srcDoc={doc}
                className="block border-0" style={{ width: logical, height: fit.h / scale, transform: `scale(${scale})`, transformOrigin: "0 0" }} />
              {pick && <Popover pick={pick} pending={pending} onCancel={() => setPick(null)} onSubmit={addComment} />}
            </div>
          ) : (
            <div className="mx-auto mt-16 max-w-md text-center text-[13px] text-zinc-500">
              <p className="font-semibold text-zinc-800">まだプロトタイプがありません</p>
              <p className="mt-1">画面の移り方まで操作できる、1つの HTML を作ります。右の「作る」から選んでください。</p>
            </div>
          )}
          {toast && <div role="status" className="absolute bottom-4 left-1/2 max-w-[80%] -translate-x-1/2 rounded-lg bg-zinc-900 px-3 py-1.5 text-[12px] text-white shadow">{toast}</div>}
        </div>
      </section>

      <aside className="flex min-h-0 flex-col border-l border-zinc-200" aria-label="プロトタイプの操作">
        <div className="flex border-b border-zinc-200 text-[12px]" role="tablist">
          {tab("comments", `コメント（${open}）`, MessageSquarePlus)}
          {!readOnly && tab("make", "作る", Sparkles)}
          {!readOnly && html && tab("code", "コード", Code2)}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 text-[12px]">
          {panel === "comments" && (
            <ol className="space-y-2" aria-label="コメント">
              {comments.length === 0 && <li className="text-[11.5px] text-zinc-400">{readOnly ? "コメントはありません。" : "「コメント」を押してから画面の部品を押すと、その部品にコメントを付けられます。AI に送ると、その部分を直した版の承認依頼が右のチャットに届きます。"}</li>}
              {comments.map((c, i) => (
                <li key={c.id} className={`rounded-lg border p-2 ${active === c.id ? "border-brand-400 bg-brand-50/40" : "border-zinc-200"} ${c.status === "resolved" ? "opacity-60" : ""}`}>
                  <button className="block w-full text-left" onClick={() => setActive(c.id === active ? null : c.id)}>
                    <div className="flex items-center gap-1.5">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[10.5px] font-semibold text-white">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-500">{c.context ? `${c.context}／` : ""}{c.label}</span>
                      <span className={`shrink-0 rounded px-1.5 text-[10.5px] font-medium ${STATUS_JA[c.status].tone}`}>{STATUS_JA[c.status].label}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-zinc-800">{c.text}</p>
                    <div className="mt-0.5 text-[10.5px] text-zinc-400">{c.by}</div>
                  </button>
                  {!readOnly && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {c.status === "open" && <button className="btn-secondary btn-sm h-6 text-[11px]" disabled={pending} onClick={() => sendLater(c)}><Send size={11} />AI に送る</button>}
                      {c.status !== "resolved" && <button className="btn-ghost btn-sm h-6 text-[11px]" disabled={pending} onClick={() => update(c.id, (x) => ({ ...x, status: "resolved" }), "解決にしました")}><Check size={11} />解決</button>}
                      <button className="btn-ghost btn-sm h-6 text-[11px] text-rose-600" disabled={pending} onClick={() => update(c.id, () => null, "コメントを消しました")} aria-label="コメントを消す"><Trash2 size={11} /></button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
          {panel === "make" && !readOnly && <MakePanel hasPages={pages.length > 0} pending={pending}
            onAssemble={() => replace(assembleProto({ product, pages, screens, flows }), "assembled", "画面からまとめました（ボタンの data-go・リンクで画面が移ります）")}
            onImport={(raw) => replace(raw, "import", "取り込みました")}
            onGenerate={(note) => start(async () => { const r = await generateProto(pid, note); setToast(r.error ?? "AI が書いています。できたら右のチャットに設計PM から承認依頼が届きます（1〜3分）"); })} />}
          {panel === "code" && !readOnly && html && <CodePanel key={html.length} html={html} pending={pending} onSave={(v) => persist({ html: v, source: "edit" }, "保存しました")} />}
        </div>
      </aside>
    </div>
  );
}

function MakePanel({ hasPages, pending, onAssemble, onImport, onGenerate }: {
  hasPages: boolean; pending: boolean; onAssemble: () => void; onImport: (raw: string) => void; onGenerate: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  const [raw, setRaw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX) { setErr("大きすぎます（1.5MB まで）"); return; }
    onImport(await f.text());
  };
  return (
    <div className="space-y-4">
      <section className="space-y-1.5" aria-label="AI で作る">
        <div className="flex items-center gap-1 font-semibold"><Sparkles size={13} />AI で作る</div>
        <p className="text-[11.5px] text-zinc-500">⑥の画面一覧・ユーザーフロー・描いた画面から、案内（シナリオ・画面の一覧・設計メモ）と端末の枠つきの、押して進めるモックアップを書きます。できたら設計PM がチャットで承認依頼を出します。</p>
        <textarea className="input text-[12px]" rows={2} value={note} onChange={(e) => setNote(e.target.value)} aria-label="AI への注文" placeholder="注文（任意）：例）スマホアプリ。初めての人のシナリオと、2回目の人のシナリオ" />
        <button className="btn-primary btn-sm" disabled={pending} onClick={() => onGenerate(note)}><Sparkles size={12} />AI で作る</button>
      </section>
      {hasPages && (
        <section className="space-y-1.5" aria-label="画面からまとめる">
          <div className="flex items-center gap-1 font-semibold"><Layers size={13} />これまでの画面からまとめる</div>
          <p className="text-[11.5px] text-zinc-500">プロトタイプに寄せる前に作った画面ごとの UI を、1つの HTML にまとめます（AI を使わず、すぐできます）。ボタン・リンクの data-go で画面が移り、ユーザーフローがシナリオになります。</p>
          <button className="btn-secondary btn-sm" disabled={pending} onClick={onAssemble}><Layers size={12} />画面からまとめる</button>
        </section>
      )}
      <section className="space-y-1.5" aria-label="HTML を取り込む">
        <div className="flex items-center gap-1 font-semibold"><FileUp size={13} />HTML を取り込む</div>
        <p className="text-[11.5px] text-zinc-500">手元のモックアップ（1つの HTML。script もそのまま動きます）を取り込みます。外への通信と外部の script は、表示するときに止めます。</p>
        <input type="file" accept=".html,.htm,text/html" aria-label="取り込む HTML ファイル" className="block w-full text-[11px]" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
        <textarea className="input font-mono text-[10.5px]" rows={3} value={raw} onChange={(e) => setRaw(e.target.value)} aria-label="貼り付ける HTML" placeholder="または HTML を貼り付け" />
        <button className="btn-secondary btn-sm" disabled={pending || !raw.trim()} onClick={() => { if (raw.length > MAX) { setErr("大きすぎます（1.5MB まで）"); return; } onImport(raw); setRaw(""); }}>貼り付けた HTML を取り込む</button>
        {err && <p className="text-[11px] text-rose-600">{err}</p>}
      </section>
    </div>
  );
}

function CodePanel({ html, pending, onSave }: { html: string; pending: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(html);
  return (
    <div className="flex h-full flex-col gap-2">
      <textarea className="input min-h-[420px] flex-1 font-mono text-[10.5px]" value={v} onChange={(e) => setV(e.target.value)} aria-label="プロトタイプの HTML" spellCheck={false} />
      <button className="btn-primary btn-sm self-start" disabled={pending || v === html} onClick={() => onSave(v)}>保存して表示</button>
    </div>
  );
}

function Popover({ pick, pending, onCancel, onSubmit }: { pick: Pick; pending: boolean; onCancel: () => void; onSubmit: (text: string, toAi: boolean) => void }) {
  const [text, setText] = useState("");
  const [toAi, setToAi] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: pick.left, top: pick.top });
  useEffect(() => {
    const host = box.current?.parentElement;
    if (!host) return;
    setPos({ left: Math.max(8, Math.min(pick.left, host.clientWidth - 272)), top: Math.max(8, Math.min(pick.top, host.clientHeight - 190)) });
    box.current?.querySelector("textarea")?.focus();
  }, [pick]);
  return (
    <div ref={box} className="absolute z-10 w-64 rounded-lg border border-zinc-200 bg-white p-2.5 text-[12px] shadow-pop" role="dialog" aria-label="コメントを書く" style={pos}>
      <div className="mb-1 flex items-center gap-1 text-[11px] text-zinc-500"><span className="min-w-0 flex-1 truncate">{pick.context ? `${pick.context}／` : ""}{pick.label}</span>
        <button onClick={onCancel} aria-label="やめる" className="text-zinc-400 hover:text-zinc-700"><X size={12} /></button></div>
      <textarea className="input text-[12px]" rows={3} value={text} onChange={(e) => setText(e.target.value)} aria-label="コメント" placeholder="例：このボタンをもっと目立たせて"
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSubmit(text, toAi); if (e.key === "Escape") onCancel(); }} />
      <label className="mt-1.5 flex items-center gap-1.5 text-[11.5px]"><input type="checkbox" checked={toAi} onChange={(e) => setToAi(e.target.checked)} />AI（設計PM）に送って直してもらう</label>
      <div className="mt-2 flex justify-end gap-1">
        <button className="btn-ghost btn-sm" onClick={onCancel}>やめる</button>
        <button className="btn-primary btn-sm" disabled={pending || !text.trim()} onClick={() => onSubmit(text, toAi)}>{toAi ? <><Send size={12} />送る</> : "残す"}</button>
      </div>
    </div>
  );
}
