"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import type { Editor } from "grapesjs";
import "grapesjs/dist/css/grapes.min.css";
import "./ui-editor.css";
import { Plus, Save, Trash2 } from "lucide-react";
import { setField } from "@/app/(app)/p/[id]/s/[stage]/actions";
import { UI_BLOCKS, UI_KIT_CSS } from "@/lib/uikit";

export type UiPage = { id: string; name: string; screen: string; html: string; css: string; project?: Record<string, unknown> | null };
type Screen = { id: string; name: string };

// エディタの日本語（主なところだけ。ほかは英語のまま）
const JA = {
  deviceManager: { device: "表示", devices: { desktop: "デスクトップ", tablet: "タブレット", mobile: "スマホ" } },
  panels: { buttons: { titles: { preview: "プレビュー", fullscreen: "全画面", "sw-visibility": "部品の枠を見せる", "export-template": "コードを見る",
    "open-sm": "見た目（スタイル）", "open-tm": "設定", "open-layers": "レイヤー", "open-blocks": "部品を足す" } } },
  domComponents: { names: { "": "箱", wrapper: "画面", text: "文字", image: "画像", link: "リンク", table: "表" } },
  styleManager: { empty: "部品を選ぶと、見た目を変えられます", layer: "レイヤー", sectors: { general: "全般", layout: "配置", typography: "文字", decorations: "装飾", extra: "その他", flex: "フレックス", dimension: "大きさ" } },
  traitManager: { empty: "部品を選ぶと、設定を変えられます", label: "部品の設定" },
  blockManager: { labels: {}, categories: { "UI 部品": "UI 部品", Basic: "基本" } },
  layerManager: { layers: "レイヤー" },
  selectorManager: { label: "クラス", selected: "選択中", emptyState: "- 状態 -", states: { hover: "ホバー", active: "押下", "nth-of-type(2n)": "偶数" } },
};

// UI デザインのエディタ（GrapesJS）：画面（ページ）ごとに部品を置き、見た目を整える。保存すると⑥の「UI デザイン」に入る。
// チャット（右）で「申込画面を作って」と頼むと、AI が画面を組んで承認依頼を出す（承認すると、ここに反映される）
export function UiEditor({ pid, value, screens, readOnly }: { pid: string; value: { pages: UiPage[] }; screens: Screen[]; readOnly: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const ed = useRef<Editor | null>(null);
  const [pages, setPages] = useState<UiPage[]>(value.pages ?? []);
  const [cur, setCur] = useState(value.pages?.[0]?.id ?? "");
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const loading = useRef(false);

  const load = (p: UiPage | undefined) => {
    const e = ed.current;
    if (!e) return;
    loading.current = true;
    if (p?.project) e.loadProjectData(p.project as never);
    else {
      e.setComponents(p?.html ?? "");
      e.setStyle(UI_KIT_CSS + (p?.css ?? ""));
    }
    setTimeout(() => { loading.current = false; }, 50);
  };
  const snapshot = (): UiPage[] => {
    const e = ed.current;
    if (!e || !cur) return pages;
    return pages.map((p) => (p.id === cur ? { ...p, html: e.getHtml().replace(/^<body[^>]*>|<\/body>$/g, ""), css: e.getCss() ?? "", project: e.getProjectData() as Record<string, unknown> } : p));
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      const grapesjs = (await import("grapesjs")).default;
      const basic = (await import("grapesjs-blocks-basic")).default;
      if (!alive || !host.current) return;
      const e = grapesjs.init({
        container: host.current, height: "100%", width: "auto", fromElement: false, storageManager: false,
        plugins: [(x: Editor) => basic(x, { flexGrid: true, category: "基本" })],
        i18n: { locale: "ja", detectLocale: false, messagesAdd: { ja: JA } },
        deviceManager: { devices: [{ id: "desktop", name: "デスクトップ", width: "" }, { id: "tablet", name: "タブレット", width: "768px", widthMedia: "992px" }, { id: "mobile", name: "スマホ", width: "375px", widthMedia: "480px" }] },
        // ボタンはアイコン（Font Awesome）ではなく日本語の文字にする
        panels: { defaults: [
          { id: "commands", buttons: [
            { id: "dev-desktop", label: "PC", command: "pf-device-desktop", active: true, togglable: false, attributes: { title: "デスクトップの幅で見る" } },
            { id: "dev-tablet", label: "タブレット", command: "pf-device-tablet", togglable: false },
            { id: "dev-mobile", label: "スマホ", command: "pf-device-mobile", togglable: false },
          ] },
          { id: "options", buttons: [
            { id: "sw-visibility", label: "枠", command: "core:component-outline", context: "sw-visibility", active: true, attributes: { title: "部品の枠を見せる" } },
            { id: "preview", label: "プレビュー", command: "core:preview", context: "preview" },
            { id: "export-template", label: "コード", command: "export-template", attributes: { title: "HTML と CSS を見る" } },
          ] },
          { id: "views", buttons: [
            { id: "open-blocks", label: "部品", command: "open-blocks", active: true, togglable: false },
            { id: "open-sm", label: "見た目", command: "open-sm", togglable: false },
            { id: "open-tm", label: "設定", command: "open-tm", togglable: false },
            { id: "open-layers", label: "レイヤー", command: "open-layers", togglable: false },
          ] },
        ] },
      });
      for (const b of UI_BLOCKS) e.BlockManager.add(b.id, { label: b.label, category: "UI 部品", content: b.content });
      for (const d of ["desktop", "tablet", "mobile"]) {
        e.Commands.add(`pf-device-${d}`, {
          run: (x: Editor) => {
            x.setDevice(d);
            for (const o of ["desktop", "tablet", "mobile"]) x.Panels.getButton("commands", `dev-${o}`)?.set("active", o === d);
          },
        });
      }
      e.on("update", () => { if (!loading.current) setDirty(true); });
      ed.current = e;
      e.on("load", () => e.runCommand("open-blocks"));
      load(pages.find((p) => p.id === cur));
      if (readOnly) e.runCommand("core:preview");
    })();
    return () => { alive = false; ed.current?.destroy(); ed.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // チャットの承認などで外から変わったら、手で触っていなければ読み直す
  useEffect(() => {
    if (dirty) return;
    setPages(value.pages ?? []);
    const p = (value.pages ?? []).find((x) => x.id === cur) ?? value.pages?.[0];
    if (p && p.id !== cur) setCur(p.id);
    load(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const go = (id: string) => {
    const next = snapshot();
    setPages(next);
    setCur(id);
    load(next.find((p) => p.id === id));
  };
  const add = () => {
    const used = new Set(pages.map((p) => p.screen));
    const sc = screens.find((s) => !used.has(s.id));
    const p: UiPage = { id: `p${Date.now().toString(36)}`, name: sc?.name || `画面${pages.length + 1}`, screen: sc?.id ?? "", html: '<main class="pf-main"><h1>新しい画面</h1></main>', css: "" };
    const next = [...snapshot(), p];
    setPages(next); setCur(p.id); load(p); setDirty(true);
  };
  const remove = (id: string) => {
    const next = snapshot().filter((p) => p.id !== id);
    setPages(next); setDirty(true);
    if (id === cur) { setCur(next[0]?.id ?? ""); load(next[0]); }
  };
  const save = () => start(async () => {
    const next = snapshot();
    setPages(next);
    const r = await setField(pid, "s06", "ui", { pages: next.map((p) => ({ ...p, project: p.project ?? null })) } as never);
    if (r.error) setMsg(r.error); else { setMsg("保存しました"); setDirty(false); }
  });
  const page = pages.find((p) => p.id === cur);
  return (
    <div className="grid h-full grid-cols-[220px_minmax(0,1fr)] gap-0 overflow-hidden rounded-xl border border-zinc-200 bg-white" aria-label="UI エディタ">
      <aside className="flex flex-col border-r border-zinc-200 bg-zinc-50/60" aria-label="画面の一覧">
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
            <label className="block text-zinc-500">画面名<input className="input mt-0.5 h-7 text-[12px]" value={page.name} aria-label="画面名" onChange={(e) => { setPages(pages.map((p) => (p.id === cur ? { ...p, name: e.target.value } : p))); setDirty(true); }} /></label>
            <label className="block text-zinc-500">画面一覧とつなぐ
              <select className="input mt-0.5 h-7 text-[12px]" value={page.screen} aria-label="つなぐ画面" onChange={(e) => { setPages(pages.map((p) => (p.id === cur ? { ...p, screen: e.target.value } : p))); setDirty(true); }}>
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
      <div className="min-h-0 min-w-0"><div ref={host} className="h-full" /></div>
    </div>
  );
}
