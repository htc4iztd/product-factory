"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowLeft, Check, Laptop, MessageSquarePlus, NotebookText, Send, Smartphone, Tablet, Trash2, X } from "lucide-react";
import { setField } from "@/app/(app)/p/[id]/s/[stage]/actions";
import { sendAssistant } from "@/lib/assistant-actions";
import { srcDoc } from "@/lib/uikit";
import { TAG_JA, type UiComment, type UiPage } from "./UiEditor";

type Screen = Record<string, string>;
const DEVICES = { mobile: { label: "スマホ", width: 390, height: 844, icon: Smartphone }, tablet: { label: "タブレット", width: 768, height: 1024, icon: Tablet }, desktop: { label: "PC", width: 1280, height: 800, icon: Laptop } } as const;
type Device = keyof typeof DEVICES;
const STATUS_JA: Record<UiComment["status"], { label: string; tone: string }> = {
  open: { label: "コメント", tone: "bg-amber-100 text-amber-800" },
  sent: { label: "AI に依頼中", tone: "bg-sky-100 text-sky-800" },
  applied: { label: "反映済み", tone: "bg-emerald-100 text-emerald-800" },
  resolved: { label: "解決", tone: "bg-zinc-100 text-zinc-500" },
};
// プロトタイプの中だけに付ける見た目（保存はしない）
const PROTO_STYLE = `<style id="pf-proto">.pf-pin{position:absolute;z-index:2147483646;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:999px 999px 999px 2px;
background:#f59e0b;color:#fff;font:600 11px/22px system-ui,sans-serif;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.25);cursor:pointer}
.pf-pin.sent{background:#0284c7}.pf-pin.applied{background:#059669}.pf-pin.on{outline:3px solid #4f46e5}
html.pf-commenting *{cursor:crosshair!important}html.pf-commenting [data-pf-hover]{outline:2px dashed #f59e0b!important;outline-offset:-2px}
[data-pf-target]{outline:2px solid #f59e0b!important;outline-offset:-2px}</style>`;

// 要素の位置（body からの CSS パス）：コメントの付け先を残すため
function cssPath(el: Element): string {
  const out: string[] = [];
  let x: Element | null = el;
  while (x && x.tagName !== "BODY" && x.tagName !== "HTML") {
    const tag = x.tagName.toLowerCase();
    const same = x.parentElement ? [...x.parentElement.children].filter((c) => c.tagName === x!.tagName) : [];
    out.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(x) + 1})` : tag);
    x = x.parentElement;
  }
  return out.join(" > ").slice(0, 500);
}
const labelOf = (el: Element) => {
  const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  const kind = TAG_JA[el.tagName] ?? el.tagName.toLowerCase();
  return t ? `${kind}「${t.slice(0, 30)}${t.length > 30 ? "…" : ""}」` : kind;
};
const find = (d: Document, sel: string): Element | null => { try { return sel ? d.querySelector(`body > ${sel}`) ?? d.querySelector(sel) : null; } catch { return null; } };

const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };

// 移り先を、画面の id・名前・画面一覧の ID（SC-xx）・ファイル名（xx.html）・#xx から探す
export function resolveGo(pages: UiPage[], raw: string): UiPage | undefined {
  const k = decodeURIComponent(raw).trim().replace(/^#\/?/, "").replace(/^\.?\//, "").replace(/\.html?$/i, "").replace(/[?#].*$/, "");
  if (!k) return undefined;
  const low = k.toLowerCase();
  return pages.find((p) => p.id === k) ?? pages.find((p) => p.screen && p.screen.toLowerCase() === low) ?? pages.find((p) => p.name.trim().toLowerCase() === low);
}

// ⑥のプロトタイプ：画面を端末の枠で通しで見て、ボタンやリンク（data-go="画面"）を押すと画面が移る。
// コメントのモードで部品を押すと、その部品にコメントを付けられ、AI（設計PM）に送るとその画面を直す承認依頼が来る
export function UiPrototype({ pid, value, screens, readOnly, me, initialPage }: {
  pid: string; value: { pages: UiPage[] }; screens: Screen[]; readOnly: boolean; me: string; initialPage?: string;
}) {
  const pages = useMemo(() => value.pages ?? [], [value]);
  const [cur, setCur] = useState(() => (pages.find((p) => p.id === initialPage) ?? pages[0])?.id ?? "");
  const [back, setBack] = useState<string[]>([]);
  const [device, setDevice] = useState<Device>("mobile");
  const [memo, setMemo] = useState(true);
  const [commenting, setCommenting] = useState(false);
  const [draft, setDraft] = useState<{ target: string; label: string; x: number; y: number; left: number; top: number } | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, UiComment[]>>(() => Object.fromEntries(pages.map((p) => [p.id, p.comments ?? []])));
  const [pending, start] = useTransition();
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ w: 800, h: 700 });
  const page = pages.find((p) => p.id === cur);
  const D = DEVICES[device];
  const scale = Math.min(1, (fit.w - 32) / D.width, (fit.h - 32) / D.height);
  const list = comments[cur] ?? [];
  const screen = screens.find((s) => s.id === page?.screen);

  useEffect(() => { setComments(Object.fromEntries(pages.map((p) => [p.id, p.comments ?? []]))); if (!pages.some((p) => p.id === cur)) setCur(pages[0]?.id ?? ""); }, [pages]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const f = () => setFit({ w: el.clientWidth, h: el.clientHeight });
    f();
    const ro = new ResizeObserver(f);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // チャットで送るときにいまの画面が伝わるよう、URL に ?page= を付けておく
  useEffect(() => {
    if (!cur) return;
    const u = new URL(window.location.href);
    u.searchParams.set("page", cur);
    window.history.replaceState(window.history.state, "", u.toString());
  }, [cur]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2500); return () => clearTimeout(t); }, [toast]);

  const goTo = useCallback((id: string, push = true) => {
    if (id === cur) return;
    if (push) setBack((b) => [...b, cur].slice(-50));
    setCur(id); setDraft(null); setActive(null);
  }, [cur]);
  const goBack = () => { const b = [...back]; const prev = b.pop(); setBack(b); if (prev) { setCur(prev); setDraft(null); setActive(null); } };

  const idoc = () => frame.current?.contentDocument ?? null;
  // ピンを画面の中に置く（部品の位置に合わせる。部品が見つからなければ残しておいた x・y の位置）
  const drawPins = useCallback(() => {
    const d = idoc();
    if (!d?.body) return;
    d.querySelectorAll(".pf-pin").forEach((x) => x.remove());
    d.querySelectorAll("[data-pf-target]").forEach((x) => x.removeAttribute("data-pf-target"));
    const W = d.documentElement.scrollWidth, H = d.documentElement.scrollHeight;
    list.forEach((c, i) => {
      if (c.status === "resolved") return;
      const el = find(d, c.target);
      const r = el?.getBoundingClientRect();
      const pin = d.createElement("div");
      pin.className = `pf-pin ${c.status}${active === c.id ? " on" : ""}`;
      pin.textContent = String(i + 1);
      pin.dataset.pfPin = c.id;
      pin.title = c.text;
      const left = r ? r.left + d.defaultView!.scrollX + Math.min(r.width - 6, 14) : (c.x / 100) * W;
      const top = r ? r.top + d.defaultView!.scrollY + 4 : (c.y / 100) * H;
      pin.style.left = `${left}px`; pin.style.top = `${top}px`;
      d.body.appendChild(pin);
    });
    if (draft) find(d, draft.target)?.setAttribute("data-pf-target", "");
  }, [list, active, draft]);
  useEffect(() => { drawPins(); }, [drawPins]);
  useEffect(() => { idoc()?.documentElement?.classList.toggle("pf-commenting", commenting); }, [commenting]);

  const state = useRef({ commenting, pages, goTo, scale });
  state.current = { commenting, pages, goTo, scale };
  const onLoad = () => {
    const d = idoc();
    if (!d) return;
    d.head.insertAdjacentHTML("beforeend", PROTO_STYLE);
    if (state.current.commenting) d.documentElement.classList.add("pf-commenting");
    d.body.style.position = d.body.style.position || "relative";
    d.addEventListener("mouseover", (e) => {
      if (!state.current.commenting) return;
      d.querySelectorAll("[data-pf-hover]").forEach((x) => x.removeAttribute("data-pf-hover"));
      const t = e.target as HTMLElement;
      if (t !== d.body && !t.classList.contains("pf-pin")) t.setAttribute("data-pf-hover", "");
    });
    d.addEventListener("submit", (e) => e.preventDefault(), true);
    d.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const pin = t.closest<HTMLElement>("[data-pf-pin]");
      if (pin) { e.preventDefault(); e.stopPropagation(); setActive(pin.dataset.pfPin ?? null); return; }
      if (state.current.commenting) {
        e.preventDefault(); e.stopPropagation();
        if (readOnly || t === d.body || t === d.documentElement) return;
        d.querySelectorAll("[data-pf-hover]").forEach((x) => x.removeAttribute("data-pf-hover"));
        const r = t.getBoundingClientRect();
        const W = d.documentElement.scrollWidth, H = d.documentElement.scrollHeight;
        const sx = d.defaultView!.scrollX, sy = d.defaultView!.scrollY;
        const s = state.current.scale;
        setDraft({
          target: cssPath(t), label: labelOf(t),
          x: Math.round(((r.left + sx + r.width / 2) / W) * 1000) / 10, y: Math.round(((r.top + sy) / H) * 1000) / 10,
          left: (r.left + Math.min(r.width, 40)) * s, top: (r.bottom + 6) * s,
        });
        setActive(null);
        return;
      }
      // 画面の移り：data-go を優先し、なければリンクの href
      const go = t.closest<HTMLElement>("[data-go]")?.dataset.go ?? t.closest("a")?.getAttribute("href") ?? null;
      if (go === null) return;
      e.preventDefault();
      const to = resolveGo(state.current.pages, go);
      if (to) state.current.goTo(to.id); else setToast(`移り先「${go}」の画面がありません`);
    }, true);
    drawPins();
  };

  const save = (next: UiComment[], note?: string) => new Promise<boolean>((resolve) => {
    const all = { ...comments, [cur]: next };
    setComments(all);
    start(async () => {
      const r = await setField(pid, "s06", "ui", { pages: pages.map((p) => ({ ...p, comments: all[p.id] ?? [] })) } as never);
      setToast(r.error ?? note ?? null);
      resolve(!r.error);
    });
  });
  const askAi = async (c: UiComment): Promise<UiComment> => {
    const text = `【UI のコメント】画面「${page?.name ?? cur}」の ${c.label}（位置 ${c.target || "画面全体"}）について：${c.text}\nこの画面を直してください。直すのは指摘の部分だけにしてください。`;
    const r = await sendAssistant(`/p/${pid}/s/s06/ui?page=${encodeURIComponent(cur)}`, text, [], []);
    if (r.error) { setToast(`AI に送れませんでした：${r.error}`); return c; }
    return { ...c, status: "sent", msg_id: r.reply?.id ?? null };
  };
  const addComment = (text: string, toAi: boolean) => {
    if (!draft || !text.trim()) return;
    start(async () => {
      let c: UiComment = { id: `c${Date.now().toString(36)}`, target: draft.target, label: draft.label, text: text.trim(), status: "open", x: draft.x, y: draft.y, by: me, at: new Date().toISOString(), msg_id: null };
      if (toAi) c = await askAi(c);
      setDraft(null); setActive(c.id);
      await save([...list, c], c.status === "sent" ? "AI（設計PM）に送りました。右のチャットに承認依頼が届きます" : "コメントを残しました");
    });
  };
  const update = (id: string, fn: (c: UiComment) => UiComment | null, note?: string) =>
    save(list.map((c) => (c.id === id ? fn(c) : c)).filter((c): c is UiComment => c !== null), note);
  const sendLater = (c: UiComment) => start(async () => { const n = await askAi(c); if (n.status === "sent") await update(c.id, () => n, "AI（設計PM）に送りました"); });

  const srcdoc = useMemo(() => srcDoc(page?.html ?? "", page?.css ?? ""), [page?.html, page?.css]);
  const memoRows: [string, string][] = screen ? [["目的", screen.purpose], ["上位の画面", screen.parent], ["主な情報・操作", screen.content], ["ストーリー", screen.stories]] : [];

  return (
    <div className="grid h-full overflow-hidden rounded-xl border border-zinc-200 bg-white" style={{ gridTemplateColumns: `${memo ? "240px " : ""}minmax(0,1fr) 280px` }} aria-label="プロトタイプ">
      {memo && (
        <aside className="min-h-0 overflow-y-auto border-r border-zinc-200 bg-zinc-50/60 p-4 text-[12.5px]" aria-label="設計メモ">
          <div className="mb-2 flex items-center gap-1.5 font-semibold"><NotebookText size={14} />設計メモ</div>
          {page ? (
            <>
              <div className="text-[14px] font-semibold">{page.name}</div>
              {page.screen && <div className="font-mono text-[11px] text-zinc-400">{page.screen}</div>}
              {screen ? (
                <dl className="mt-3 space-y-2">
                  {memoRows.filter(([, v]) => v).map(([k, v]) => <div key={k}><dt className="text-[11px] font-semibold text-zinc-400">{k}</dt><dd className="whitespace-pre-wrap text-zinc-700">{v}</dd></div>)}
                </dl>
              ) : <p className="mt-3 text-[11.5px] text-zinc-400">⑥の画面一覧とつながっていません（「編集」で画面一覧の ID とつなぐと、ここに目的や主な操作が出ます）。</p>}
              <div className="mt-4 text-[11px] font-semibold text-zinc-400">この画面から移れる先</div>
              <Links page={page} pages={pages} onGo={(id) => goTo(id)} />
            </>
          ) : <p className="text-zinc-400">画面がありません。</p>}
        </aside>
      )}

      <section className="flex min-h-0 min-w-0 flex-col bg-zinc-100">
        <div className="flex items-center gap-1 border-b border-zinc-200 bg-white px-3 py-1.5">
          <button className={`btn-ghost btn-sm h-7 px-1.5 ${memo ? "text-brand-700" : ""}`} aria-pressed={memo} onClick={() => setMemo((x) => !x)} title="設計メモ"><NotebookText size={14} /></button>
          <button className="btn-ghost btn-sm h-7 px-1.5" onClick={goBack} disabled={!back.length} aria-label="前の画面に戻る" title="前の画面に戻る"><ArrowLeft size={14} /></button>
          <span className="min-w-0 truncate text-[12.5px] font-medium" aria-label="いまの画面">{page?.name ?? "—"}</span>
          <span className="ml-auto flex shrink-0">
            {(Object.keys(DEVICES) as Device[]).map((k) => {
              const X = DEVICES[k];
              return <button key={k} className={`rounded-md px-2 py-1.5 ${device === k ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`} aria-pressed={device === k} aria-label={X.label} onClick={() => setDevice(k)} title={`${X.label}（${X.width}px）`}><X.icon size={13} /></button>;
            })}
          </span>
          {!readOnly && (
            <button title="コメント中は、画面の部品を押すとコメントを付けられます" className={`ml-2 flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1 text-[12px] font-medium ${commenting ? "bg-amber-500 text-white" : "border border-zinc-200 text-zinc-700 hover:bg-zinc-50"}`}
              aria-pressed={commenting} onClick={() => { setCommenting((x) => !x); setDraft(null); }}>
              <MessageSquarePlus size={13} />{commenting ? "コメント中" : "コメント"}</button>
          )}
        </div>
        <div ref={box} className="relative min-h-0 flex-1 overflow-hidden">
          {page ? (
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <div className={`relative overflow-hidden bg-white shadow-[0_12px_40px_rgba(0,0,0,0.18)] ${device === "mobile" ? "rounded-[28px] ring-[6px] ring-zinc-900" : "rounded-lg ring-1 ring-zinc-300"}`}
                style={{ width: D.width * scale, height: D.height * scale }}>
                <iframe key={`${cur}:${hash(srcdoc)}`} ref={frame} title="プロトタイプの画面" sandbox="allow-same-origin" srcDoc={srcdoc} onLoad={onLoad}
                  style={{ width: D.width, height: D.height, transform: `scale(${scale})`, transformOrigin: "0 0", border: 0, display: "block" }} />
                {draft && <Popover box={{ w: D.width * scale, h: D.height * scale }} draft={draft} pending={pending} onCancel={() => setDraft(null)} onSubmit={addComment} />}
              </div>
            </div>
          ) : <p className="mt-20 text-center text-[13px] text-zinc-400">画面がありません。「編集」で画面を足すか、右のチャットで「申込画面を作って」と頼みます。</p>}
          {toast && <div role="status" className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-zinc-900 px-3 py-1.5 text-[12px] text-white shadow">{toast}</div>}
        </div>
      </section>

      <aside className="flex min-h-0 flex-col border-l border-zinc-200" aria-label="画面とコメント">
        <div className="border-b border-zinc-200 px-3 py-2 text-[12.5px] font-semibold">画面（{pages.length}）</div>
        <ul className="max-h-[40%] overflow-y-auto py-1" aria-label="画面の一覧">
          {pages.map((p) => {
            const open = (comments[p.id] ?? []).filter((c) => c.status === "open" || c.status === "sent").length;
            return (
              <li key={p.id}>
                <button onClick={() => goTo(p.id)} aria-pressed={p.id === cur} className={`flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[12.5px] ${p.id === cur ? "bg-brand-50 font-medium text-brand-800" : "hover:bg-zinc-50"}`}>
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {open > 0 && <span className="rounded-full bg-amber-100 px-1.5 text-[10.5px] text-amber-800">{open}</span>}
                  {p.screen && <span className="font-mono text-[10px] text-zinc-400">{p.screen}</span>}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="border-y border-zinc-200 px-3 py-2 text-[12.5px] font-semibold">この画面のコメント（{list.filter((c) => c.status !== "resolved").length}）</div>
        <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3" aria-label="コメント">
          {list.length === 0 && <li className="text-[11.5px] text-zinc-400">{readOnly ? "コメントはありません。" : "「コメント」を押してから画面の部品を押すと、その部品にコメントを付けられます。AI に送ると、その部分を直す承認依頼が右のチャットに届きます。"}</li>}
          {list.map((c, i) => (
            <li key={c.id} className={`rounded-lg border p-2 text-[12px] ${active === c.id ? "border-brand-400 bg-brand-50/40" : "border-zinc-200"} ${c.status === "resolved" ? "opacity-60" : ""}`}>
              <button className="block w-full text-left" onClick={() => setActive(c.id === active ? null : c.id)}>
                <div className="flex items-center gap-1.5">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-[10.5px] font-semibold text-white">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-500">{c.label}</span>
                  <span className={`rounded px-1.5 text-[10.5px] font-medium ${STATUS_JA[c.status].tone}`}>{STATUS_JA[c.status].label}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-zinc-800">{c.text}</p>
                <div className="mt-0.5 text-[10.5px] text-zinc-400">{c.by}{c.at && `・${new Date(c.at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`}</div>
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
      </aside>
    </div>
  );
}

// 設計メモの「移れる先」：この画面の data-go・リンクを拾う
function Links({ page, pages, onGo }: { page: UiPage; pages: UiPage[]; onGo: (id: string) => void }) {
  // DOMParser はブラウザにしかないので、表示のあとで拾う（サーバーの描画と食い違わないように）
  const [gos, setGos] = useState<{ label: string; to?: UiPage; raw: string }[]>([]);
  useEffect(() => {
    const d = new DOMParser().parseFromString(page.html, "text/html");
    const seen = new Map<string, { label: string; to?: UiPage; raw: string }>();
    d.querySelectorAll("[data-go],a[href]").forEach((el) => {
      const raw = el.getAttribute("data-go") ?? el.getAttribute("href") ?? "";
      if (!raw || raw === "#" || seen.has(raw)) return;
      seen.set(raw, { raw, label: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 20), to: resolveGo(pages, raw) });
    });
    setGos([...seen.values()]);
  }, [page.html, pages]);
  if (!gos.length) return <p className="mt-1 text-[11.5px] text-zinc-400">ありません（ボタンやリンクに data-go="画面" を付けると移れます）。</p>;
  return (
    <ul className="mt-1 space-y-1">
      {gos.map((g) => (
        <li key={g.raw} className="text-[12px]">
          {g.to ? <button className="text-brand-700 hover:underline" onClick={() => onGo(g.to!.id)}>{g.label || g.raw} → {g.to.name}</button>
            : <span className="text-zinc-400">{g.label || g.raw} → 「{g.raw}」がありません</span>}
        </li>
      ))}
    </ul>
  );
}

function Popover({ box, draft, pending, onCancel, onSubmit }: {
  box: { w: number; h: number }; draft: { label: string; left: number; top: number }; pending: boolean; onCancel: () => void; onSubmit: (text: string, toAi: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [toAi, setToAi] = useState(true);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="absolute z-10 w-64 rounded-lg border border-zinc-200 bg-white p-2.5 text-[12px] shadow-pop" role="dialog" aria-label="コメントを書く"
      style={{ left: Math.max(4, Math.min(draft.left, box.w - 260)), top: Math.max(4, Math.min(draft.top, box.h - 170)) }}>
      <div className="mb-1 flex items-center gap-1 text-[11px] text-zinc-500"><span className="min-w-0 flex-1 truncate">{draft.label}</span>
        <button onClick={onCancel} aria-label="やめる" className="text-zinc-400 hover:text-zinc-700"><X size={12} /></button></div>
      <textarea ref={ref} className="input text-[12px]" rows={3} value={text} onChange={(e) => setText(e.target.value)} aria-label="コメント" placeholder="例：このボタンをもっと目立たせて"
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSubmit(text, toAi); if (e.key === "Escape") onCancel(); }} />
      <label className="mt-1.5 flex items-center gap-1.5 text-[11.5px]"><input type="checkbox" checked={toAi} onChange={(e) => setToAi(e.target.checked)} />AI（設計PM）に送って直してもらう</label>
      <div className="mt-2 flex justify-end gap-1">
        <button className="btn-ghost btn-sm" onClick={onCancel}>やめる</button>
        <button className="btn-primary btn-sm" disabled={pending || !text.trim()} onClick={() => onSubmit(text, toAi)}>{toAi ? <><Send size={12} />送る</> : "残す"}</button>
      </div>
    </div>
  );
}
