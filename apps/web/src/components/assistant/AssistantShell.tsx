"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AtSign, Check, CornerDownLeft, Library, MessageSquare, PanelRightClose, Send, X } from "lucide-react";
import type { AssistantMsg, ChatActionT, MentionT } from "@/lib/agent";
import { decideAssistant, researchBrief, sendAssistant } from "@/lib/assistant-actions";
import { Avatar } from "@/components/rail/Avatar";
import { AttachButton, AttachChips, SentAttachments, useAttachments } from "@/components/chat/Attachments";
import { ResearchImport } from "@/components/chat/ResearchImport";
import { srcDoc } from "@/lib/uikit";
import { ValueDiff, summarize } from "@/components/diff/ValueDiff";

const POLL_MS = 4000;
const PM_OF: Record<string, string> = Object.fromEntries([
  ...["s01", "s02", "s03", "s04", "s05"].map((s) => [s, "事業PM"]),
  ...["s06", "s07", "s08", "s09", "s10", "s11"].map((s) => [s, "設計PM"]),
  ...["s12", "s13", "s14"].map((s) => [s, "実装PM"]),
]);
const PLATFORM_PAGES = ["platform", "schedule", "cast", "team", "agents", "frameworks"];
const time = (t: string) => new Date(t).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

// いまのページと、送ったときに答える相手の見込み（実際の宛先は送ったあとに決まる）
function where(path: string, choices: MentionT[], mentions: MentionT[]): { label: string; who: string } {
  const first = mentions[0];
  if (first?.kind === "agent") return { label: first.label, who: first.label };
  if (first?.kind === "stage") return { label: first.label, who: PM_OF[first.ref] ?? "PM" };
  const p = first?.kind === "page" ? first.ref : path;
  const m = p.match(/^\/p\/[0-9a-f]+(?:\/([^/]+)(?:\/([^/]+))?)?/);
  if (!m) return { label: "ファクトリー全体", who: "プラットフォーム" };
  const [, seg, sub] = m;
  if (seg === "s" && sub) return { label: `${choices.find((c) => c.ref === sub)?.label ?? sub}${p.endsWith("/ui") ? "の UI エディタ" : ""}`, who: PM_OF[sub] ?? "PM" };
  if (seg === "pm" && sub) return { label: `${choices.find((c) => c.ref === sub)?.label ?? sub}の作業場所`, who: choices.find((c) => c.ref === sub)?.label ?? "PM" };
  if (seg && PLATFORM_PAGES.includes(seg)) return { label: choices.find((c) => c.ref.endsWith(`/${seg}`))?.label ?? seg, who: "プラットフォーム" };
  const page = choices.find((c) => c.kind === "page" && c.ref === p.split("?")[0]);
  return { label: page?.label ?? (seg ? seg : "ダッシュボード"), who: "内容から PM が決まります" };
}

// チャットを開くボタン：各ページの見出しのボタン（Issue・掲示板など）の並びに置く。閉じているときだけ出る
type ChatCtl = { open: boolean; setOpen: (v: boolean) => void; unread: number; pending: number; mount: (d: number) => void };
const ChatContext = createContext<ChatCtl | null>(null);
export function ChatToggle() {
  const c = useContext(ChatContext);
  useEffect(() => { c?.mount(1); return () => c?.mount(-1); }, [c?.mount]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!c || c.open) return null;
  return (
    <button onClick={() => c.setOpen(true)} className="btn-secondary gap-1.5" aria-label="チャットを開く">
      <MessageSquare size={14} />チャット{c.unread > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[10px] text-white">{c.unread}</span>}
      {c.pending > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-[10px] text-white">承認 {c.pending}</span>}
    </button>
  );
}

// ファクトリー全体で1つのチャット：右端に対話、下に入力欄。どのページにいても同じ1本の対話
export function AssistantShell({ children, initialOpen }: { children: React.ReactNode; initialOpen: boolean }) {
  const path = usePathname();
  const router = useRouter();
  const pid = path.match(/^\/p\/([0-9a-f]{8,32})/)?.[1] ?? null;
  const [open, setOpenState] = useState(initialOpen);
  const [msgs, setMsgs] = useState<AssistantMsg[]>([]);
  const [seen, setSeen] = useState(0);
  const setOpen = (v: boolean) => { setOpenState(v); document.cookie = `pf_chat=${v ? "open" : "closed"}; path=/; max-age=31536000; samesite=lax`; };
  const [incoming, setIncoming] = useState<{ text?: string; mention?: MentionT; n: number } | null>(null);
  // 対話はプロダクトごと（プロダクトの外のページでは、ファクトリー全体の対話）
  const load = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const r = await fetch(`/api/assistant/feed?product=${pid ?? ""}`, { cache: "no-store" });
      if (r.ok) setMsgs(await r.json());
    } catch { /* 次の回で読む */ }
  }, [pid]);
  useEffect(() => { setMsgs([]); }, [pid]);
  // ⌘K などから「チャットで話す」：チャットを開いて入力欄に入れる
  useEffect(() => {
    const onCompose = (e: Event) => {
      const d = (e as CustomEvent<{ text?: string; mention?: MentionT }>).detail ?? {};
      setOpen(true);
      setIncoming((x) => ({ ...d, n: (x?.n ?? 0) + 1 }));
    };
    window.addEventListener("pf:compose", onCompose);
    return () => window.removeEventListener("pf:compose", onCompose);
  });
  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);
  const lastId = msgs.at(-1)?.id ?? 0;
  useEffect(() => { if (open) setSeen(lastId); }, [open, lastId]);
  const unread = msgs.filter((m) => m.id > seen && m.role === "agent").length;
  const pending = msgs.reduce((n, m) => n + m.actions.filter((a) => a.status === "pending").length, 0);
  const [toggles, setToggles] = useState(0);
  const mount = useCallback((d: number) => setToggles((n) => n + d), []);
  return (
    <ChatContext.Provider value={{ open, setOpen, unread, pending, mount }}>
    <div className="flex min-h-screen">
      <div className="min-w-0 flex-1">{children}</div>
      {open ? (
        <aside className="sticky top-0 flex h-screen w-[400px] shrink-0 flex-col border-l border-zinc-200 bg-white" aria-label="チャット">
          <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2.5">
            <MessageSquare size={15} className="text-brand-600" />
            <h2 className="text-[14px] font-semibold">チャット</h2>
            {pending > 0 && <span className="rounded-full bg-amber-100 px-2 text-[11px] font-medium text-amber-800">承認待ち {pending}</span>}
            <button onClick={() => setOpen(false)} className="btn-ghost btn-sm ml-auto h-7 w-7 p-0" aria-label="チャットを閉じる"><PanelRightClose size={15} /></button>
          </div>
          <Feed msgs={msgs} onChanged={(m) => { setMsgs((xs) => xs.map((x) => (x.id === m.id ? m : x))); router.refresh(); }} />
          <Composer path={path} pid={pid} incoming={incoming} onSent={(m) => { setMsgs((xs) => [...xs.filter((x) => x.id < m.id), m]); load(); }} />
        </aside>
      ) : toggles > 0 ? null : (
        <button onClick={() => setOpen(true)} className="btn-secondary fixed right-3 top-3 z-40 gap-1.5" aria-label="チャットを開く">
          <MessageSquare size={14} />チャット{unread > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[10px] text-white">{unread}</span>}
          {pending > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-[10px] text-white">承認 {pending}</span>}
        </button>
      )}
    </div>
    </ChatContext.Provider>
  );
}

function Feed({ msgs, onChanged }: { msgs: AssistantMsg[]; onChanged: (m: AssistantMsg) => void }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs.length]);
  return (
    <ol className="flex-1 space-y-2.5 overflow-y-auto px-3 py-3" aria-label="チャットのやり取り">
      {msgs.length === 0 && <li className="px-1 text-[12px] text-zinc-400">下の欄から話しかけます。何も指さなければ、いま開いているページについての指示・質問になります。@ で別のページ・工程・エージェントを指せます。何かを変えるときは、ここに承認依頼が出ます。</li>}
      {msgs.map((m) => {
        const me = m.role === "pdm";
        return (
          <li key={m.id} className={`flex items-end gap-2 ${me ? "justify-end" : ""}`} data-msg={m.id}>
            {!me && <Avatar k={m.agent} size={26} />}
            <div className={`max-w-[88%] rounded-xl px-3 py-2 text-[12.5px] ${me ? "bg-zinc-900 text-white" : m.context.ask ? "bg-amber-50 text-zinc-900 ring-1 ring-amber-200" : "bg-zinc-100 text-zinc-800"}`}>
              <div className={`mb-0.5 flex flex-wrap gap-x-1 text-[10px] ${me ? "text-zinc-400" : "text-zinc-500"}`}>
                <span>{me ? "PdM" : m.agent_name}・{time(m.created_at)}</span>
                {m.context.ask_label && <span className="rounded bg-amber-200 px-1 font-semibold text-amber-900">{m.context.ask_label}</span>}
                {(m.context.label || m.context.product_name) && (
                  <span className={`rounded px-1 ${me ? "bg-zinc-700 text-zinc-200" : "bg-white text-zinc-600"}`}>
                    {m.context.product_name ? `${m.context.product_name}／` : ""}{m.context.label}{m.context.mentioned ? "（@）" : ""}
                  </span>
                )}
              </div>
              <div className="whitespace-pre-wrap">{m.text}</div>
              <SentAttachments items={m.attachments as never} dark={me} />
              {m.actions.map((a) => <ActionCard key={a.id} m={m} a={a} onChanged={onChanged} />)}
              {(m.context.ask === "question" || m.context.ask === "consult") && (
                <button className="btn-secondary btn-sm mt-2" onClick={() => {
                  const mention = { kind: "agent" as const, ref: m.agent, label: m.agent_name };
                  window.dispatchEvent(new CustomEvent("pf:compose", { detail: { mention, text: `@${m.agent_name} ` } }));
                }}><CornerDownLeft size={12} />{m.agent_name}に返事をする</button>
              )}
            </div>
          </li>
        );
      })}
      <div ref={end} />
    </ol>
  );
}

// 承認依頼：変更前と変更後を並べ、承認したものだけ実行する
function ActionCard({ m, a, onChanged }: { m: AssistantMsg; a: ChatActionT; onChanged: (m: AssistantMsg) => void }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const decide = (approve: boolean) => start(async () => {
    const r = await decideAssistant(m.id, a.id, approve);
    if (r.error) setErr(r.error); else if (r.message) onChanged(r.message);
  });
  // PdM への合意依頼・終了承認依頼は、ボタンの言葉を型に合わせる
  const kind = a.type === "pm_ask" ? (a as ChatActionT & { args?: { kind?: string } }).args?.kind : undefined;
  const words = kind === "agree_next" ? { badge: "合意依頼", yes: "合意する", no: "合意しない", did: "合意しました", didnt: "合意しませんでした" }
    : kind === "approve_done" ? { badge: "終了承認依頼", yes: "終了を承認", no: "否認（続けてもらう）", did: "承認しました", didnt: "否認しました" }
    : { badge: "承認依頼", yes: "承認", no: "否認", did: "承認しました", didnt: "否認しました" };
  const tone = a.status === "approved" ? "border-emerald-300" : a.status === "rejected" ? "border-zinc-200 opacity-70" : a.status === "failed" ? "border-rose-300" : "border-amber-300";
  return (
    <div className={`mt-2 rounded-lg border bg-white p-2.5 text-zinc-800 ${tone}`} role="group" aria-label={`承認依頼：${a.title}`}>
      <div className="flex items-center gap-1.5 text-[12px] font-semibold">
        {a.status === "pending" && <span className="rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800">{words.badge}</span>}
        {a.title}
      </div>
      {a.reason && <div className="mt-0.5 text-[11px] text-zinc-500">{a.reason}</div>}
      {a.changes?.length ? (
        <div className="mt-1.5 space-y-1.5">
          {a.changes.map((c, j) => (
            <div key={j}><div className="mb-0.5 text-[10.5px]"><span className="rounded bg-amber-50 px-1.5 font-medium text-amber-800">{summarize(c)}</span></div><ValueDiff c={c} /></div>
          ))}
        </div>
      ) : (
      <div className="mt-1.5 grid gap-1.5 text-[11.5px] sm:grid-cols-2">
          <div><div className="text-[10px] text-zinc-400">変更前</div><div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-zinc-50 px-2 py-1 text-zinc-600">{a.before}</div></div>
          <div><div className="text-[10px] text-zinc-400">変更後</div><div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-emerald-50 px-2 py-1 text-zinc-900">{a.after}</div></div>
        </div>
      )}
      {(a as ChatActionT & { preview?: { html: string; css: string } }).preview && (
        <div className="mt-1.5 overflow-hidden rounded border border-zinc-200 bg-zinc-50">
          <div className="px-2 py-0.5 text-[10px] text-zinc-400">下見（変更後）</div>
          <div className="relative h-48 overflow-hidden">
            <iframe title="変更後の下見" sandbox="" className="pointer-events-none absolute left-0 top-0 h-[384px] w-[200%] origin-top-left scale-50 border-0"
              srcDoc={srcDoc((a as ChatActionT & { preview: { html: string; css: string } }).preview.html, (a as ChatActionT & { preview: { html: string; css: string } }).preview.css)} />
          </div>
        </div>
      )}
      {a.status === "pending" ? (
        <div className="mt-2 flex gap-1.5">
          <button className="btn-primary btn-sm" disabled={pending} onClick={() => decide(true)}><Check size={12} />{words.yes}</button>
          <button className="btn-secondary btn-sm" disabled={pending} onClick={() => decide(false)}><X size={12} />{words.no}</button>
        </div>
      ) : (
        <div className={`mt-1.5 text-[11px] ${a.status === "approved" ? "text-emerald-700" : a.status === "failed" ? "text-rose-600" : "text-zinc-500"}`}>
          {a.status === "approved" ? words.did : a.status === "rejected" ? words.didnt : "実行できませんでした"}：{a.result}
        </div>
      )}
      {err && <div className="mt-1 text-[11px] text-rose-600">{err}</div>}
    </div>
  );
}

function Composer({ path, pid, incoming, onSent }: { path: string; pid: string | null; incoming: { text?: string; mention?: MentionT; n: number } | null; onSent: (m: AssistantMsg) => void }) {
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<MentionT[]>([]);
  const [choices, setChoices] = useState<MentionT[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [pending, start] = useTransition();
  const box = useRef<HTMLTextAreaElement>(null);
  const files = useAttachments(pid ?? "_", "assistant");
  useEffect(() => {
    fetch(`/api/assistant/mentions?product=${pid ?? ""}`).then((r) => (r.ok ? r.json() : [])).then(setChoices).catch(() => setChoices([]));
  }, [pid]);
  // ⌘K などから「チャットで話す」（シェルが受けて渡す）
  useEffect(() => {
    if (!incoming) return;
    const m = incoming.mention;
    if (m) setMentions((x) => (x.some((y) => y.ref === m.ref) ? x : [...x, m]));
    if (incoming.text) setText(incoming.text);
    setTimeout(() => box.current?.focus(), 10);
  }, [incoming]);
  const stage = path.match(/^\/p\/[0-9a-f]+\/s\/(s\d\d)/)?.[1] ?? null;
  const w = where(path, choices, mentions);
  const hits = useMemo(() => (query === null ? [] : choices.filter((c) => c.label.toLowerCase().includes(query.toLowerCase())).slice(0, 8)), [query, choices]);
  const onType = (v: string) => {
    setText(v);
    const caret = box.current?.selectionStart ?? v.length;
    const m = v.slice(0, caret).match(/@([^\s@]*)$/);
    setQuery(m ? m[1] : null);
    setIdx(0);
  };
  const pick = (c: MentionT) => {
    const caret = box.current?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@([^\s@]*)$/, `@${c.label} `);
    setText(before + text.slice(caret));
    setMentions((x) => (x.some((y) => y.ref === c.ref) ? x : [...x, c]));
    setQuery(null);
    setTimeout(() => box.current?.focus(), 10);
  };
  const send = (t = text, material = "") => {
    if (!t.trim() || pending) return;
    const used = mentions.filter((m) => t.includes(`@${m.label}`) || material);
    start(async () => {
      const r = await sendAssistant(path, t, used, files.items.map((a) => a.id), material);
      if (r.error) { setError(r.error); return; }
      setText(""); setMentions([]); setError(null); files.clear();
      if (r.reply) onSent(r.reply);
    });
  };
  return (
    <div className="relative border-t border-zinc-200 bg-white px-3 py-2" aria-label="チャットの入力">
      {query !== null && hits.length > 0 && (
        <ul className="absolute inset-x-3 bottom-full z-10 mb-1 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-pop" role="listbox" aria-label="メンションの候補">
          {hits.map((c, i) => (
            <li key={c.kind + c.ref} role="option" aria-selected={i === idx}>
              <button onMouseDown={(e) => { e.preventDefault(); pick(c); }} className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] ${i === idx ? "bg-brand-50" : ""}`}>
                <span className="rounded bg-zinc-100 px-1 text-[10px] text-zinc-500">{{ stage: "工程", page: "ページ", agent: "エージェント", issue: "Issue" }[c.kind]}</span>{c.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {importing && pid && stage && (
        <div className="absolute inset-x-3 bottom-full z-10 mb-1">
          <ResearchImport busy={pending} onClose={() => setImporting(false)} onSend={(n, issue, label) => start(async () => {
            setImporting(false);
            const b = await researchBrief(n, issue);
            if (b.error) { setError(b.error); return; }
            const r = await sendAssistant(path, `${label}。この工程の項目を、根拠（[RF-n]・[RA-n]）つきで見直すよう担当に依頼して`, [], [], b.brief ?? "");
            if (r.error) setError(r.error); else if (r.reply) onSent(r.reply);
          })} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-500">
        <span>話題：<span className="font-medium text-zinc-700">{w.label}</span></span>
        <span>答える人：<span className="font-medium text-zinc-700">{w.who}</span></span>
        {mentions.map((m) => (
          <span key={m.ref} className="flex items-center gap-0.5 rounded-full bg-brand-50 px-2 text-brand-800">@{m.label}
            <button onClick={() => setMentions((x) => x.filter((y) => y.ref !== m.ref))} aria-label={`${m.label}のメンションを外す`}><X size={10} /></button>
          </span>
        ))}
        <AttachChips a={files} />
        {error && <span className="text-rose-600">{error}</span>}
        {pending && <span className="text-brand-700">{w.who === "内容から PM が決まります" ? "考えています…" : `${w.who}が考えています…`}</span>}
      </div>
      <div className="mt-1 space-y-1.5">
        <textarea ref={box} rows={3} value={text} aria-label="チャットに話す" onPaste={pid ? files.onPaste : undefined}
          placeholder="このページについて指示・質問（@ で別のページ・工程・エージェント）。Enter で送る・Shift+Enter で改行"
          className="input min-h-0 w-full resize-none text-[13px]"
          onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => {
            if (query !== null && hits.length) {
              if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, hits.length - 1)); return; }
              if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); return; }
              if ((e.key === "Enter" || e.key === "Tab") && !e.nativeEvent.isComposing) { e.preventDefault(); pick(hits[idx]); return; }
              if (e.key === "Escape") { setQuery(null); return; }
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
          }} />
        <div className="flex items-center justify-between gap-1">
          <div className="flex gap-1">
            <button className="btn-ghost btn-sm h-8 w-8 p-0" title="メンション（@）" aria-label="メンションする" onClick={() => { onType(text + "@"); setText(text + "@"); box.current?.focus(); }}><AtSign size={14} /></button>
            {pid ? <AttachButton a={files} disabled={pending} /> : null}
            {pid && stage && <button className="btn-ghost btn-sm h-8 w-8 p-0" title="リサーチから取り込む" aria-label="リサーチから取り込む" onClick={() => setImporting((x) => !x)}><Library size={14} /></button>}
          </div>
          <button className="btn-primary btn-sm" aria-label="チャットを送る" disabled={pending || !text.trim() || files.busy} onClick={() => send()}><Send size={12} />送る</button>
        </div>
      </div>
    </div>
  );
}

