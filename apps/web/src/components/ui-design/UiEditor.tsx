"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Code2, Copy, CornerLeftUp, Laptop, MousePointerClick, Plus, Redo2, Save, Smartphone, Tablet, Trash2, Undo2 } from "lucide-react";
import { setField } from "@/app/(app)/p/[id]/s/[stage]/actions";
import { UI_BLOCKS, srcDoc } from "@/lib/uikit";

export type UiPage = { id: string; name: string; screen: string; html: string; css: string; project?: Record<string, unknown> | null };
type Screen = { id: string; name: string };

const DEVICES = { desktop: { label: "PC", width: 1280, icon: Laptop }, tablet: { label: "タブレット", width: 768, icon: Tablet }, mobile: { label: "スマホ", width: 390, icon: Smartphone } } as const;
type Device = keyof typeof DEVICES;
// エディタだけが付ける印（保存するときに外す）
const EDITOR_STYLE = `<style id="pf-editor">[data-pf-hover]{outline:2px dashed #a5b4fc!important;outline-offset:-2px}[data-pf-sel]{outline:2px solid #4f46e5!important;outline-offset:-2px}[contenteditable="true"]{outline:2px solid #f59e0b!important;cursor:text}*{cursor:default}</style>`;
const TEXT_TAGS = new Set(["H1", "H2", "H3", "H4", "P", "SPAN", "STRONG", "EM", "A", "BUTTON", "LABEL", "LI", "TD", "TH", "SMALL", "B", "OPTION"]);
const TAG_JA: Record<string, string> = {
  HEADER: "ヘッダー", MAIN: "本文", SECTION: "区画", DIV: "箱", NAV: "ナビ", ASIDE: "サイドバー", FOOTER: "フッター", H1: "見出し1", H2: "見出し2", H3: "見出し3",
  P: "文章", SPAN: "文字", STRONG: "太字", A: "リンク", BUTTON: "ボタン", INPUT: "入力欄", SELECT: "選択欄", LABEL: "ラベル", FORM: "フォーム", UL: "リスト", LI: "リストの項目",
  TABLE: "表", TR: "表の行", TD: "表のセル", TH: "表の見出し", IMG: "画像", HR: "区切り線", I: "棒",
};
const KIT_CLASSES = ["pf-card", "pf-grid", "pf-row", "pf-stack", "pf-between", "pf-hero", "pf-btn", "secondary", "ghost", "sm", "block", "pf-badge", "ok", "warn", "bad", "pf-muted", "narrow"];
const STYLE_FIELDS: { key: string; label: string; ph: string }[] = [
  { key: "fontSize", label: "文字の大きさ", ph: "14px" }, { key: "fontWeight", label: "太さ", ph: "600" }, { key: "color", label: "文字の色", ph: "#18181b" },
  { key: "background", label: "背景", ph: "#ffffff" }, { key: "padding", label: "内側の余白", ph: "16px" }, { key: "margin", label: "外側の余白", ph: "0 auto" },
  { key: "borderRadius", label: "角丸", ph: "12px" }, { key: "width", label: "幅", ph: "100%" }, { key: "textAlign", label: "揃え", ph: "left / center" }, { key: "gap", label: "部品の間隔", ph: "12px" },
];

// 保存用の HTML：エディタが付けた印を外す
function clean(doc: Document): string {
  const body = doc.body.cloneNode(true) as HTMLElement;
  body.querySelectorAll("[data-pf-hover],[data-pf-sel],[contenteditable]").forEach((el) => {
    el.removeAttribute("data-pf-hover"); el.removeAttribute("data-pf-sel"); el.removeAttribute("contenteditable");
  });
  return body.innerHTML.trim();
}

// ⑥UXデザインの UI エディタ（自作）：画面をそのまま表示し、クリックで部品を選んで並べ替え・複製・削除・見た目の変更、
// ダブルクリックで文字を直接書き換える。部品を足す・HTML と CSS を直接書く・元に戻す もできる。
// 保存すると⑥の「UI デザイン」に入る。右のチャットで AI に頼むと、画面を組んで承認依頼を出す（承認するとここに反映）
export function UiEditor({ pid, value, screens, readOnly }: { pid: string; value: { pages: UiPage[] }; screens: Screen[]; readOnly: boolean }) {
  const [pages, setPages] = useState<UiPage[]>(value.pages ?? []);
  const [cur, setCur] = useState(value.pages?.[0]?.id ?? "");
  const [device, setDevice] = useState<Device>("desktop");
  const [tab, setTab] = useState<"blocks" | "select" | "code">("blocks");
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [, bump] = useState(0);
  const [doc, setDoc] = useState(() => ({ html: value.pages?.[0]?.html ?? "", css: value.pages?.[0]?.css ?? "", n: 0 })); // iframe に読み込む中身
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const sel = useRef<HTMLElement | null>(null);
  const hist = useRef<{ past: string[]; future: string[] }>({ past: [], future: [] });
  const [scale, setScale] = useState(1);
  const [areaH, setAreaH] = useState(820);
  const page = pages.find((p) => p.id === cur);
  const width = DEVICES[device].width;

  // 表示の倍率：キャンバスの幅に収める
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => { setScale(Math.min(1, (el.clientWidth - 48) / width)); setAreaH(el.clientHeight - 48); };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  const idoc = () => frame.current?.contentDocument ?? null;
  const select = useCallback((el: HTMLElement | null) => {
    const d = idoc();
    d?.querySelectorAll("[data-pf-sel]").forEach((x) => x.removeAttribute("data-pf-sel"));
    sel.current = el && el !== d?.body ? el : null;
    sel.current?.setAttribute("data-pf-sel", "");
    if (sel.current) setTab("select");
    bump((x) => x + 1);
  }, []);
  // いまの iframe の中身を、ページの html にする（元に戻すための記録も残す）
  const commit = useCallback(() => {
    const d = idoc();
    if (!d) return;
    const html = clean(d);
    setPages((ps) => ps.map((p) => {
      if (p.id !== cur) return p;
      if (p.html !== html) { hist.current.past.push(p.html); hist.current.future = []; if (hist.current.past.length > 60) hist.current.past.shift(); }
      return { ...p, html, project: null };
    }));
    setDirty(true);
    bump((x) => x + 1);
  }, [cur]);
  const load = (html: string, css: string) => { sel.current = null; setDoc((x) => ({ html, css, n: x.n + 1 })); };

  // iframe を読み込んだら、選ぶ・文字を書き換える の操作をつなぐ
  const onLoad = () => {
    const d = idoc();
    if (!d) return;
    d.head.insertAdjacentHTML("beforeend", EDITOR_STYLE);
    if (readOnly) return;
    d.addEventListener("mouseover", (e) => { d.querySelectorAll("[data-pf-hover]").forEach((x) => x.removeAttribute("data-pf-hover")); const t = e.target as HTMLElement; if (t !== d.body) t.setAttribute("data-pf-hover", ""); });
    d.addEventListener("mouseleave", () => d.querySelectorAll("[data-pf-hover]").forEach((x) => x.removeAttribute("data-pf-hover")));
    d.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.isContentEditable) return;
      e.preventDefault();
      select(t);
    }, true);
    d.addEventListener("submit", (e) => e.preventDefault(), true);
    d.addEventListener("dblclick", (e) => {
      const t = e.target as HTMLElement;
      if (!TEXT_TAGS.has(t.tagName)) return;
      e.preventDefault();
      t.contentEditable = "true";
      t.focus();
      const done = () => { t.removeAttribute("contenteditable"); t.removeEventListener("blur", done); commit(); };
      t.addEventListener("blur", done);
    });
    d.addEventListener("keydown", (e) => { if (e.key === "Escape" && (e.target as HTMLElement).isContentEditable) (e.target as HTMLElement).blur(); });
  };

  // チャットの承認などで外から変わったら、手で触っていなければ読み直す
  useEffect(() => {
    if (dirty) return;
    const ps = value.pages ?? [];
    setPages(ps);
    const p = ps.find((x) => x.id === cur) ?? ps[0];
    if (p && p.id !== cur) setCur(p.id);
    load(p?.html ?? "", p?.css ?? "");
    hist.current = { past: [], future: [] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const go = (id: string) => {
    const p = pages.find((x) => x.id === id);
    setCur(id); hist.current = { past: [], future: [] }; load(p?.html ?? "", p?.css ?? ""); setTab("blocks");
  };
  const add = () => {
    const used = new Set(pages.map((p) => p.screen));
    const sc = screens.find((s) => !used.has(s.id));
    const p: UiPage = { id: `p${Date.now().toString(36)}`, name: sc?.name || `画面${pages.length + 1}`, screen: sc?.id ?? "", html: '<main class="pf-main"><h1>新しい画面</h1><p>部品を足すか、右のチャットで「この画面を作って」と頼みます。</p></main>', css: "", project: null };
    setPages([...pages, p]); setCur(p.id); load(p.html, p.css); setDirty(true); hist.current = { past: [], future: [] };
  };
  const remove = (id: string) => {
    const next = pages.filter((p) => p.id !== id);
    setPages(next); setDirty(true);
    if (id === cur) { setCur(next[0]?.id ?? ""); load(next[0]?.html ?? "", next[0]?.css ?? ""); }
  };
  const patch = (k: keyof UiPage, v: string) => { setPages((ps) => ps.map((p) => (p.id === cur ? { ...p, [k]: v } : p))); setDirty(true); };

  // 部品の操作
  const act = (fn: (el: HTMLElement, d: Document) => HTMLElement | null | void) => {
    const d = idoc(), el = sel.current;
    if (!d || !el) return;
    const next = fn(el, d);
    commit();
    if (next !== undefined) select(next);
  };
  const insert = (html: string) => {
    const d = idoc();
    if (!d) return;
    const t = d.createElement("template");
    t.innerHTML = html;
    const node = t.content.firstElementChild as HTMLElement | null;
    const el = sel.current;
    const host = d.querySelector("main") ?? d.body;
    if (el && el !== d.body) el.after(t.content); else host.append(t.content);
    commit();
    if (node) { select(node); node.scrollIntoView({ block: "center" }); }
  };
  const undo = () => {
    const prev = hist.current.past.pop();
    if (prev === undefined || !page) return;
    hist.current.future.push(page.html);
    setPages((ps) => ps.map((p) => (p.id === cur ? { ...p, html: prev } : p))); load(prev, page.css); setDirty(true);
  };
  const redo = () => {
    const nxt = hist.current.future.pop();
    if (nxt === undefined || !page) return;
    hist.current.past.push(page.html);
    setPages((ps) => ps.map((p) => (p.id === cur ? { ...p, html: nxt } : p))); load(nxt, page.css); setDirty(true);
  };
  // キーボード：⌘Z・⌘⇧Z（元に戻す・やり直す）、Delete（選んだ部品を消す）
  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.("input,textarea,select,[contenteditable='true']");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !typing) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      if ((e.key === "Delete" || e.key === "Backspace") && sel.current && !typing) { e.preventDefault(); act((el) => { const p = el.parentElement; el.remove(); return p; }); }
    };
    window.addEventListener("keydown", onKey);
    const d = idoc();
    d?.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); d?.removeEventListener("keydown", onKey); };
  });

  const save = () => start(async () => {
    const r = await setField(pid, "s06", "ui", { pages: pages.map((p) => ({ ...p, project: null })) } as never);
    if (r.error) setMsg(r.error); else { setMsg("保存しました"); setDirty(false); }
  });

  const el = sel.current;
  const path = useMemo(() => {
    const out: HTMLElement[] = [];
    let x = el;
    while (x && x.tagName !== "BODY") { out.unshift(x); x = x.parentElement; }
    return out;
  }, [el, el?.parentElement]); // eslint-disable-line react-hooks/exhaustive-deps
  const textOnly = el && [...el.childNodes].every((n) => n.nodeType === Node.TEXT_NODE);
  const groups = [...new Set(UI_BLOCKS.map((b) => b.group))];
  const srcdoc = useMemo(() => srcDoc(doc.html, doc.css), [doc]);

  return (
    <div className="grid h-full grid-cols-[200px_minmax(0,1fr)_300px] overflow-hidden rounded-xl border border-zinc-200 bg-white" aria-label="UI エディタ">
      <aside className="flex min-h-0 flex-col border-r border-zinc-200 bg-zinc-50/60" aria-label="画面の一覧">
        <div className="flex items-center gap-1 border-b border-zinc-200 px-3 py-2 text-[12.5px] font-semibold">画面（{pages.length}）
          {!readOnly && <button className="btn-ghost btn-sm ml-auto h-7 px-1.5" onClick={add} aria-label="画面を足す"><Plus size={13} /></button>}
        </div>
        <ul className="flex-1 overflow-y-auto py-1">
          {pages.length === 0 && <li className="px-3 py-2 text-[11.5px] text-zinc-400">画面がありません。＋で足すか、右のチャットで「申込画面を作って」と頼みます。</li>}
          {pages.map((p) => (
            <li key={p.id}>
              <button onClick={() => go(p.id)} aria-pressed={p.id === cur} className={`flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[12.5px] ${p.id === cur ? "bg-brand-50 font-medium text-brand-800" : "hover:bg-white"}`}>
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {p.screen && <span className="font-mono text-[10px] text-zinc-400">{p.screen}</span>}
              </button>
            </li>
          ))}
        </ul>
        {page && !readOnly && (
          <div className="space-y-1.5 border-t border-zinc-200 p-3 text-[11.5px]">
            <label className="block text-zinc-500">画面名<input className="input mt-0.5 h-7 text-[12px]" value={page.name} aria-label="画面名" onChange={(e) => patch("name", e.target.value)} /></label>
            <label className="block text-zinc-500">画面一覧とつなぐ
              <select className="input mt-0.5 h-7 text-[12px]" value={page.screen} aria-label="つなぐ画面" onChange={(e) => patch("screen", e.target.value)}>
                <option value="">（つながない）</option>
                {screens.map((s) => <option key={s.id} value={s.id}>{s.id} {s.name}</option>)}
              </select>
            </label>
            <button className="btn-ghost btn-sm text-rose-600" onClick={() => remove(cur)}><Trash2 size={12} />この画面を消す</button>
          </div>
        )}
        {!readOnly && (
          <div className="flex items-center gap-2 border-t border-zinc-200 p-3">
            <button className="btn-primary btn-sm" disabled={pending || !dirty} onClick={save}><Save size={12} />{pending ? "保存中…" : "保存"}</button>
            <span className="text-[11px] text-zinc-500" role="status">{dirty ? "保存していない変更があります" : msg}</span>
          </div>
        )}
      </aside>

      <section className="flex min-h-0 min-w-0 flex-col bg-zinc-100">
        <div className="flex items-center gap-1 border-b border-zinc-200 bg-white px-3 py-1.5">
          {(Object.keys(DEVICES) as Device[]).map((k) => {
            const D = DEVICES[k];
            return <button key={k} className={`flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[12px] ${device === k ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`} aria-pressed={device === k} onClick={() => setDevice(k)} title={`${D.width}px`}><D.icon size={13} />{D.label}</button>;
          })}
          <span className="ml-2 whitespace-nowrap text-[11px] text-zinc-400">{width}px・{Math.round(scale * 100)}%</span>
          {!readOnly && (
            <span className="ml-auto flex items-center gap-1">
              <span className="mr-1 text-zinc-400" title="クリックで選ぶ・ダブルクリックで文字を書き換える・Delete で消す"><MousePointerClick size={13} /></span>
              <button className="btn-ghost btn-sm h-7 px-1.5" onClick={undo} disabled={!hist.current.past.length} aria-label="元に戻す" title="元に戻す（⌘Z）"><Undo2 size={14} /></button>
              <button className="btn-ghost btn-sm h-7 px-1.5" onClick={redo} disabled={!hist.current.future.length} aria-label="やり直す" title="やり直す（⌘⇧Z）"><Redo2 size={14} /></button>
            </span>
          )}
        </div>
        <div ref={box} className="min-h-0 flex-1 overflow-auto p-6" onClick={(e) => { if (e.target === e.currentTarget) select(null); }}>
          {page ? (
            <div className="mx-auto overflow-hidden rounded-lg bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)] ring-1 ring-zinc-200" style={{ width: width * scale, height: Math.max(areaH, 300) }}>
              <iframe key={doc.n} ref={frame} title="UI のキャンバス" sandbox="allow-same-origin" srcDoc={srcdoc} onLoad={onLoad}
                style={{ width, height: Math.max(areaH, 300) / scale, transform: `scale(${scale})`, transformOrigin: "0 0", border: 0, display: "block" }} />
            </div>
          ) : <p className="mt-20 text-center text-[13px] text-zinc-400">左の＋で画面を足します</p>}
        </div>
      </section>

      <aside className="flex min-h-0 flex-col border-l border-zinc-200" aria-label="編集">
        <div className="flex border-b border-zinc-200 text-[12px]" role="tablist">
          {([["blocks", "部品を足す"], ["select", "選んだ部品"], ["code", "コード"]] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`flex-1 py-2 ${tab === k ? "border-b-2 border-zinc-900 font-semibold" : "text-zinc-500"}`}>{l}</button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 text-[12px]">
          {readOnly && <p className="text-zinc-500">閲覧のみです。</p>}
          {!readOnly && tab === "blocks" && (
            <div className="space-y-3">
              <p className="text-[11px] text-zinc-500">{el ? "選んだ部品のすぐ後ろに足します。" : "本文の最後に足します（部品を選ぶと、その後ろに足します）。"}</p>
              {groups.map((g) => (
                <div key={g}>
                  <div className="mb-1 text-[11px] font-semibold text-zinc-400">{g}</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {UI_BLOCKS.filter((b) => b.group === g).map((b) => (
                      <button key={b.id} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-left hover:border-brand-300 hover:bg-brand-50" onClick={() => insert(b.content)}>{b.label}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {!readOnly && tab === "select" && (!el ? <p className="text-zinc-500">画面の部品をクリックして選びます。</p> : (
            <div className="space-y-3" key={String(el.outerHTML.length)}>
              <nav className="flex flex-wrap items-center gap-0.5 text-[11px]" aria-label="部品の位置">
                {path.map((x, i) => <button key={i} onClick={() => select(x)} className={`rounded px-1 ${x === el ? "bg-brand-100 font-semibold text-brand-800" : "text-zinc-500 hover:bg-zinc-100"}`}>{TAG_JA[x.tagName] ?? x.tagName.toLowerCase()}{i < path.length - 1 ? " ›" : ""}</button>)}
              </nav>
              <div className="flex flex-wrap gap-1">
                <button className="btn-secondary btn-sm" onClick={() => el.parentElement && el.parentElement.tagName !== "BODY" && select(el.parentElement)} aria-label="親を選ぶ"><CornerLeftUp size={12} />親</button>
                <button className="btn-secondary btn-sm" onClick={() => act((x) => { const p = x.previousElementSibling; if (p) p.before(x); return x; })} aria-label="上へ"><ArrowUp size={12} /></button>
                <button className="btn-secondary btn-sm" onClick={() => act((x) => { const n = x.nextElementSibling; if (n) n.after(x); return x; })} aria-label="下へ"><ArrowDown size={12} /></button>
                <button className="btn-secondary btn-sm" onClick={() => act((x) => { const c = x.cloneNode(true) as HTMLElement; c.removeAttribute("data-pf-sel"); x.after(c); return c; })} aria-label="複製"><Copy size={12} />複製</button>
                <button className="btn-secondary btn-sm text-rose-600" onClick={() => act((x) => { const p = x.parentElement; x.remove(); return p?.tagName === "BODY" ? null : p; })} aria-label="部品を消す"><Trash2 size={12} />消す</button>
              </div>
              {textOnly && (
                <label className="block"><span className="label">文字</span>
                  <textarea className="input text-[12px]" rows={2} defaultValue={el.textContent ?? ""} aria-label="部品の文字" onBlur={(e) => { if (e.target.value !== el.textContent) { el.textContent = e.target.value; commit(); } }} /></label>
              )}
              {["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName) && (
                <label className="block"><span className="label">入力の見本（placeholder）</span>
                  <input className="input h-8 text-[12px]" defaultValue={el.getAttribute("placeholder") ?? ""} onBlur={(e) => { el.setAttribute("placeholder", e.target.value); commit(); }} /></label>
              )}
              <div>
                <span className="label">クラス（部品集の見た目）</span>
                <div className="flex flex-wrap gap-1">
                  {KIT_CLASSES.map((c) => {
                    const on = el.classList.contains(c);
                    return <button key={c} aria-pressed={on} onClick={() => { el.classList.toggle(c); commit(); }} className={`rounded-full border px-2 py-0.5 font-mono text-[10.5px] ${on ? "border-brand-400 bg-brand-50 text-brand-800" : "border-zinc-200 text-zinc-500"}`}>{c}</button>;
                  })}
                </div>
              </div>
              <div>
                <span className="label">見た目（この部品だけ）</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {STYLE_FIELDS.map((f) => (
                    <label key={f.key} className="block text-[11px] text-zinc-500">{f.label}
                      <input className="input mt-0.5 h-7 font-mono text-[11px]" placeholder={f.ph} defaultValue={(el.style as unknown as Record<string, string>)[f.key] ?? ""}
                        aria-label={f.label} onBlur={(e) => { (el.style as unknown as Record<string, string>)[f.key] = e.target.value; commit(); }} />
                    </label>
                  ))}
                </div>
              </div>
            </div>
          ))}
          {!readOnly && tab === "code" && page && <CodeTab key={`${cur}:${doc.n}`} page={page} onApply={(html, css) => {
            hist.current.past.push(page.html); hist.current.future = [];
            setPages((ps) => ps.map((p) => (p.id === cur ? { ...p, html, css, project: null } : p))); load(html, css); setDirty(true);
          }} />}
        </div>
      </aside>
    </div>
  );
}

function CodeTab({ page, onApply }: { page: UiPage; onApply: (html: string, css: string) => void }) {
  const [html, setHtml] = useState(page.html);
  const [css, setCss] = useState(page.css);
  const changed = html !== page.html || css !== page.css;
  return (
    <div className="space-y-2">
      <label className="block"><span className="label flex items-center gap-1"><Code2 size={12} />HTML（body の中身）</span>
        <textarea className="input font-mono text-[11px]" rows={16} value={html} onChange={(e) => setHtml(e.target.value)} aria-label="HTML" spellCheck={false} /></label>
      <label className="block"><span className="label">CSS（この画面だけ。部品集の上に重ねる）</span>
        <textarea className="input font-mono text-[11px]" rows={8} value={css} onChange={(e) => setCss(e.target.value)} aria-label="CSS" spellCheck={false} /></label>
      <button className="btn-primary btn-sm" disabled={!changed} onClick={() => onApply(html, css)}>キャンバスに反映</button>
    </div>
  );
}
