"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowUp, AtSign, ChevronDown, Menu, MessageSquare, Monitor, Plus, X } from "lucide-react";
import type { AssistantMsg, MentionT, Quote } from "@/lib/agent";
import { Feed, QuoteBox } from "@/components/assistant/AssistantShell";
import { AttachButton, AttachChips, useAttachments } from "@/components/chat/Attachments";
import { switchView } from "@/lib/mobile";
import { useChatSend, type Live, type SendBody } from "@/components/chat/LiveTurn";

const POLL_MS = 4000;
type NavStage = { id: string; no: string; name: string; status: string; enabled: boolean };
type Nav = { product: { id: string; name: string }; stages: NavStage[] } | null;
export type Topic = { path: string; label: string };

type Ctl = {
  pid: string | null; msgs: AssistantMsg[]; pending: number; nav: Nav; live: Live | null;
  replace: (m: AssistantMsg) => void; reload: () => void; openChat: () => void;
};
const MobileContext = createContext<Ctl | null>(null);
export const useMobile = () => useContext(MobileContext)!;

// いまの URL から、入力欄の話題（送るときのページ）を決める
function topicOf(path: string, nav: Nav): Topic {
  const m = path.match(/^\/p\/([0-9a-f]{8,32})(?:\/(.*))?$/);
  if (!m) return { path: "/", label: "ファクトリー全体" };
  const [, pid, rest = ""] = m;
  const st = rest.match(/^s\/(s\d\d)(\/ui)?/);
  if (st) {
    const s = nav?.stages.find((x) => x.id === st[1]);
    const name = s ? `${s.no}${s.name}` : st[1];
    return st[2] ? { path: `/p/${pid}/s/${st[1]}/ui?mode=proto`, label: `${name}の UI プロトタイプ` } : { path: `/p/${pid}/s/${st[1]}`, label: name };
  }
  const iss = rest.match(/^issues\/(\d+)/);
  if (iss) return { path: `/p/${pid}/issues/${iss[1]}`, label: `Issue #${iss[1]}` };
  return { path: `/p/${pid}`, label: "プロダクト全体" };
}

// スマホの骨組み：上のバー（≡・プロダクト名・PC 版）・中身・下の入力欄（どの画面にも常にある。あらゆる指示の起点）
export function MobileShell({ children, products }: { children: React.ReactNode; products: { id: string; name: string }[] }) {
  const path = usePathname();
  const router = useRouter();
  const pid = path.match(/^\/p\/([0-9a-f]{8,32})/)?.[1] ?? null;
  const [msgs, setMsgs] = useState<AssistantMsg[]>([]);
  const [nav, setNav] = useState<Nav>(null);
  const [drawer, setDrawer] = useState(false);
  const [sheet, setSheet] = useState(false);
  const home = path === "/" || /^\/p\/[0-9a-f]+$/.test(path);

  const load = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const r = await fetch(`/api/assistant/feed?product=${pid ?? ""}`, { cache: "no-store" });
      if (r.ok) setMsgs(await r.json());
    } catch { /* 次の回で読む */ }
  }, [pid]);
  useEffect(() => { setMsgs([]); load(); const t = setInterval(load, POLL_MS); return () => clearInterval(t); }, [load]);
  useEffect(() => {
    setNav(null);
    if (!pid) return;
    fetch(`/api/p/${pid}/nav`).then((r) => (r.ok ? r.json() : null)).then(setNav).catch(() => setNav(null));
  }, [pid]);
  useEffect(() => { setDrawer(false); setSheet(false); }, [path]);
  const pending = msgs.reduce((n, m) => n + m.actions.filter((a) => a.status === "pending").length, 0);
  const replace = useCallback((m: AssistantMsg) => { setMsgs((xs) => xs.map((x) => (x.id === m.id ? m : x))); router.refresh(); }, [router]);
  // 送る：その場で発言を出し、返事は流れてくるまま出す（ホーム以外では、チャットが下から出る）
  const chat = useChatSend((mine, reply) => {
    setMsgs((xs) => [...xs.filter((x) => x.id !== mine.id && x.id !== reply.id), mine, reply].sort((a, b) => a.id - b.id));
    load();
  });
  const onSend = (b: SendBody) => { if (!home) setSheet(true); return chat.send(b); };
  const title = pid ? (nav?.product.name ?? products.find((p) => p.id === pid)?.name ?? "") : "ファクトリー";

  return (
    <MobileContext.Provider value={{ pid, msgs, pending, nav, live: chat.live, replace, reload: load, openChat: () => setSheet(true) }}>
      <div className="flex h-[100dvh] flex-col bg-white" data-mobile>
        <header className="flex h-12 shrink-0 items-center gap-1 border-b border-zinc-200 px-2">
          <button className="flex h-10 w-10 items-center justify-center rounded-lg text-zinc-700 active:bg-zinc-100" aria-label="メニューを開く" onClick={() => setDrawer(true)}><Menu size={20} /></button>
          <Link href={pid ? `/p/${pid}` : "/"} className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</Link>
          {pending > 0 && (
            <Link href={pid ? `/p/${pid}?tab=approve` : "/?tab=approve"} className="rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-semibold text-white" aria-label={`承認待ち ${pending}`}>承認 {pending}</Link>
          )}
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</main>
        <Composer key={path} path={path} pid={pid} nav={nav} home={home} busy={!!chat.live} onSend={onSend} onOpenChat={() => setSheet(true)} />
        {drawer && <Drawer products={products} pid={pid} nav={nav} path={path} onClose={() => setDrawer(false)} />}
        {sheet && !home && (
          <div className="fixed inset-0 z-40 flex flex-col bg-black/30" onClick={(e) => { if (e.target === e.currentTarget) setSheet(false); }}>
            <div className="mt-auto flex h-[72dvh] flex-col rounded-t-2xl bg-white shadow-2xl" role="dialog" aria-label="チャット">
              <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2">
                <MessageSquare size={15} className="text-brand-600" /><span className="text-[14px] font-semibold">チャット</span>
                <button className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg" aria-label="チャットを閉じる" onClick={() => setSheet(false)}><X size={18} /></button>
              </div>
              <Feed msgs={msgs} live={chat.live} onChanged={replace} />
            </div>
          </div>
        )}
      </div>
    </MobileContext.Provider>
  );
}

// 左から出る一覧：プロダクトの切り替え・このプロダクトの工程・PC 版
function Drawer({ products, pid, nav, path, onClose }: { products: { id: string; name: string }[]; pid: string | null; nav: Nav; path: string; onClose: () => void }) {
  const item = (href: string, label: string, sub?: string) => (
    <li key={href}><Link href={href} className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-[14px] active:bg-zinc-100 ${path === href.split("?")[0] ? "bg-zinc-100 font-semibold" : ""}`}>
      <span className="min-w-0 flex-1 truncate">{label}</span>{sub && <span className="shrink-0 text-[11px] text-zinc-400">{sub}</span>}</Link></li>
  );
  return (
    <div className="fixed inset-0 z-50 flex bg-black/30" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <nav className="flex h-full w-[84%] max-w-[340px] flex-col bg-white shadow-2xl" aria-label="メニュー">
        <div className="flex h-12 items-center border-b border-zinc-100 px-3"><span className="text-[15px] font-semibold">メニュー</span>
          <button className="ml-auto flex h-10 w-10 items-center justify-center" aria-label="メニューを閉じる" onClick={onClose}><X size={18} /></button></div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {pid && nav && (
            <>
              <div className="px-3 pb-1 pt-2 text-[11px] font-semibold text-zinc-400">{nav.product.name}</div>
              <ul>
                {item(`/p/${pid}`, "チャット・承認・進捗")}
                {item(`/p/${pid}/s/s06/ui`, "UI のプロトタイプ")}
                {nav.stages.filter((s) => s.enabled).map((s) => item(`/p/${pid}/s/${s.id}`, `${s.no} ${s.name}`))}
              </ul>
            </>
          )}
          <div className="px-3 pb-1 pt-4 text-[11px] font-semibold text-zinc-400">プロダクト</div>
          <ul>
            {item("/", "ファクトリー全体")}
            {products.map((p) => item(`/p/${p.id}`, p.name))}
          </ul>
        </div>
        <button className="flex items-center gap-2 border-t border-zinc-100 px-5 py-3 text-[13px] text-zinc-600" onClick={() => switchView("pc")}><Monitor size={15} />PC 版で見る</button>
      </nav>
    </div>
  );
}

// 下の入力欄：話題（どのページについての指示か）を上に出し、タップで切り替える。@ で工程・エージェントを指す。添付もできる
function Composer({ path, pid, nav, home, busy, onSend, onOpenChat }: {
  path: string; pid: string | null; nav: Nav; home: boolean; busy: boolean; onSend: (b: SendBody) => Promise<string | null>; onOpenChat: () => void;
}) {
  const base = useMemo(() => topicOf(path, nav), [path, nav]);
  const [topic, setTopic] = useState<Topic | null>(null);
  const t = topic ?? base;
  const [text, setText] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [mentions, setMentions] = useState<MentionT[]>([]);
  const [choices, setChoices] = useState<MentionT[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const files = useAttachments(pid ?? "_", "assistant");
  useEffect(() => {
    fetch(`/api/assistant/mentions?product=${pid ?? ""}`).then((r) => (r.ok ? r.json() : [])).then(setChoices).catch(() => setChoices([]));
  }, [pid]);
  // チャットの「〜に返事をする」：引用と宛先を入れる
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ text?: string; mention?: MentionT; quote?: Quote }>).detail ?? {};
      const m = d.mention;
      if (m) setMentions((x) => (x.some((y) => y.ref === m.ref) ? x : [...x, m]));
      if (d.text) setText(d.text);
      if (d.quote) setQuote(d.quote);
      setTimeout(() => box.current?.focus(), 10);
    };
    window.addEventListener("pf:compose", on);
    return () => window.removeEventListener("pf:compose", on);
  }, []);
  // 入力に合わせて高さを変える（1〜6行）
  useEffect(() => { const el = box.current; if (!el) return; el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 140)}px`; }, [text]);
  const hits = useMemo(() => (query === null ? [] : choices.filter((c) => c.label.toLowerCase().includes(query.toLowerCase())).slice(0, 6)), [query, choices]);
  const onType = (v: string) => { setText(v); const caret = box.current?.selectionStart ?? v.length; const m = v.slice(0, caret).match(/@([^\s@]*)$/); setQuery(m ? m[1] : null); };
  const pick = (c: MentionT) => {
    const caret = box.current?.selectionStart ?? text.length;
    setText(text.slice(0, caret).replace(/@([^\s@]*)$/, `@${c.label} `) + text.slice(caret));
    setMentions((x) => (x.some((y) => y.ref === c.ref) ? x : [...x, c]));
    setQuery(null);
    setTimeout(() => box.current?.focus(), 10);
  };
  const send = async () => {
    if (!text.trim() || busy) return;
    const used = mentions.filter((m) => text.includes(`@${m.label}`) || (quote && m.ref === quote.agent));
    const body: SendBody = { path: t.path, text, mentions: used, attachments: files.items.map((a) => a.id), reply_to: quote?.id ?? null };
    const keep = { text, mentions, quote };
    setText(""); setMentions([]); setQuote(null); setError(null); files.clear(); setMore(false);
    const err = await onSend(body);
    if (err) { setError(err); setText(keep.text); setMentions(keep.mentions); setQuote(keep.quote); }
  };
  // 話題の候補：プロダクト全体・工程・UI のプロトタイプ（プロダクトの外ではファクトリー全体だけ）
  const topics: Topic[] = pid && nav ? [
    { path: `/p/${pid}`, label: "プロダクト全体" },
    { path: `/p/${pid}/s/s06/ui?mode=proto`, label: "⑥UXデザインの UI プロトタイプ" },
    ...nav.stages.filter((s) => s.enabled).map((s) => ({ path: `/p/${pid}/s/${s.id}`, label: `${s.no}${s.name}` })),
  ] : [{ path: "/", label: "ファクトリー全体" }];

  return (
    <div className="relative shrink-0 border-t border-zinc-200 bg-white px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-1.5" aria-label="チャットの入力">
      {query !== null && hits.length > 0 && (
        <ul className="absolute inset-x-2 bottom-full z-20 mb-1 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg" role="listbox" aria-label="メンションの候補">
          {hits.map((c) => (
            <li key={c.kind + c.ref}><button onMouseDown={(e) => { e.preventDefault(); pick(c); }} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[14px] active:bg-brand-50">
              <span className="rounded bg-zinc-100 px-1 text-[10px] text-zinc-500">{{ stage: "工程", page: "ページ", agent: "エージェント", issue: "Issue" }[c.kind]}</span>{c.label}</button></li>
          ))}
        </ul>
      )}
      {picking && (
        <div className="absolute inset-x-2 bottom-full z-20 mb-1 max-h-[50dvh] overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-lg" role="listbox" aria-label="話題を選ぶ">
          <div className="sticky top-0 bg-white px-3 py-2 text-[11px] font-semibold text-zinc-400">何についての指示・質問か</div>
          {topics.map((x) => (
            <button key={x.path} role="option" aria-selected={x.path === t.path} onClick={() => { setTopic(x.path === base.path ? null : x); setPicking(false); }}
              className={`block w-full px-3 py-2.5 text-left text-[14px] active:bg-brand-50 ${x.path === t.path ? "font-semibold text-brand-700" : ""}`}>{x.label}</button>
          ))}
        </div>
      )}
      <div className="mb-1 flex items-center gap-1.5 text-[11.5px]">
        <button className="flex min-w-0 items-center gap-0.5 rounded-full bg-zinc-100 px-2.5 py-1 text-zinc-700" onClick={() => { setPicking((x) => !x); setQuery(null); }} aria-label={`話題：${t.label}`}>
          <span className="truncate">話題：{t.label}</span><ChevronDown size={12} className="shrink-0" /></button>
        {mentions.map((m) => (
          <span key={m.ref} className="flex shrink-0 items-center gap-0.5 rounded-full bg-brand-50 px-2 py-1 text-brand-800">@{m.label}
            <button onClick={() => setMentions((x) => x.filter((y) => y.ref !== m.ref))} aria-label={`${m.label}のメンションを外す`}><X size={11} /></button></span>
        ))}
        {!home && <button className="ml-auto flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-zinc-500" onClick={onOpenChat} aria-label="チャットを見る"><MessageSquare size={13} />チャット</button>}
      </div>
      {quote && <QuoteBox q={quote} onRemove={() => setQuote(null)} />}
      <AttachChips a={files} />
      {error && <div className="mb-1 text-[12px] text-rose-600">{error}</div>}
      {more && (
        <div className="mb-1 flex gap-2">
          <button className="flex items-center gap-1 rounded-full border border-zinc-200 px-3 py-1.5 text-[13px]" onClick={() => { onType(text + "@"); setMore(false); box.current?.focus(); }}><AtSign size={14} />工程・エージェントを指す</button>
          {pid && <span className="flex items-center rounded-full border border-zinc-200 px-1"><AttachButton a={files} disabled={busy} /></span>}
        </div>
      )}
      <div className="flex items-end gap-1.5">
        <button className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${more ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700"}`} aria-label="ほかの操作" onClick={() => setMore((x) => !x)}><Plus size={18} /></button>
        <textarea ref={box} rows={1} value={text} aria-label="チャットに話す" onPaste={pid ? files.onPaste : undefined}
          placeholder={busy ? "返事を書いています…" : "指示・質問を入力"}
          className="min-h-10 flex-1 resize-none rounded-2xl border border-zinc-300 bg-white px-3.5 py-2 text-[16px] leading-6 outline-none focus:border-zinc-500"
          onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
        <button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white disabled:bg-zinc-300" aria-label="チャットを送る" disabled={busy || !text.trim() || files.busy} onClick={send}><ArrowUp size={18} /></button>
      </div>
    </div>
  );
}
