"use client";
import { useState, useTransition } from "react";
import { FileText } from "lucide-react";
import type { ReportSource } from "@/lib/agent";
import { GROUPS } from "@/lib/groups";
import { createReport } from "@/app/(app)/p/[id]/reports/actions";

type Sel = Record<string, string[]>;   // 工程 → 選んだ項目

// 報告に使う範囲（工程 → 項目）を選び、読み手と目的を決めて作る
export function NewReportForm({ pid, sources, phases }: { pid: string; sources: ReportSource[]; phases: Record<string, string[]> }) {
  const by = Object.fromEntries(sources.map((s) => [s.id, s]));
  const filled = (sid: string) => by[sid].fields.filter((f) => f.filled).map((f) => f.key);
  const [sel, setSel] = useState<Sel>({});
  const [title, setTitle] = useState("");
  const [audience, setAudience] = useState("");
  const [purpose, setPurpose] = useState("");
  const [slides, setSlides] = useState(8);
  const [source, setSource] = useState("latest");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const toggleStage = (sid: string, on: boolean) => setSel((x) => {
    const y = { ...x };
    if (on) y[sid] = filled(sid).length ? filled(sid) : by[sid].fields.map((f) => f.key); else delete y[sid];
    return y;
  });
  const toggleField = (sid: string, key: string) => setSel((x) => {
    const cur = x[sid] ?? [];
    const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
    const y = { ...x };
    if (next.length) y[sid] = next; else delete y[sid];
    return y;
  });
  const preset = (ids: string[]) => setSel(Object.fromEntries(ids.filter((s) => by[s]?.enabled && filled(s).length).map((s) => [s, filled(s)])));
  const count = Object.values(sel).reduce((a, x) => a + x.length, 0);

  function submit() {
    setError(null);
    const selection = sources.filter((s) => sel[s.id]).map((s) => ({ stage: s.id, fields: sel[s.id] }));
    start(async () => {
      const r = await createReport(pid, { title, audience, purpose, selection, source, slides });
      if (r?.error) setError(r.error);
    });
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="card space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="text-zinc-500">まとめて選ぶ：</span>
          <button type="button" className="btn-ghost btn-sm" onClick={() => preset(["s01", "s02", "s03", "s04", "s05"])}>事業（①〜⑤）</button>
          <button type="button" className="btn-ghost btn-sm" onClick={() => preset(["s06", "s07", "s08", "s09", "s10", "s11"])}>要求・設計（⑥〜⑪）</button>
          <button type="button" className="btn-ghost btn-sm" onClick={() => preset(sources.map((s) => s.id))}>中身のある項目すべて</button>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setSel({})}>選び直す</button>
          <span className="ml-auto text-zinc-500">{Object.keys(sel).length} 工程・{count} 項目</span>
        </div>
        {GROUPS.map((g) => (
          <div key={g.title}>
            <div className="section-title mb-1.5">{g.title}</div>
            <div className="space-y-2">
              {g.phases.flatMap((ph) => phases[ph] ?? []).map((sid) => {
                const s = by[sid];
                if (!s) return null;
                const on = Boolean(sel[sid]);
                return (
                  <div key={sid} className={`rounded-lg border p-2.5 ${on ? "border-brand-300 bg-brand-50/40" : "border-zinc-200"} ${s.enabled ? "" : "opacity-50"}`}>
                    <label className="flex items-center gap-2 text-[13px] font-medium">
                      <input type="checkbox" checked={on} disabled={!s.enabled} onChange={(e) => toggleStage(sid, e.target.checked)} aria-label={`${s.no}${s.name}を使う`} />
                      {s.no} {s.name}
                      <span className="text-[11px] font-normal text-zinc-400">{s.version ? `最新版 v${s.version}` : "下書き"}</span>
                    </label>
                    {on && (
                      <div className="mt-1.5 flex flex-wrap gap-1 pl-6">
                        {s.fields.map((f) => {
                          const picked = sel[sid]?.includes(f.key);
                          return (
                            <button key={f.key} type="button" aria-pressed={picked} onClick={() => toggleField(sid, f.key)}
                              className={`rounded-full border px-2 py-0.5 text-[11px] ${picked ? "border-brand-400 bg-white text-brand-800" : "border-zinc-200 text-zinc-500"} ${f.filled ? "" : "border-dashed"}`}
                              title={f.filled ? undefined : "まだ空です"}>
                              {f.label}{!f.filled && "（空）"}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="card h-fit space-y-3 p-5 xl:sticky xl:top-4">
        <label className="block"><span className="label">題</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例：事業化判断のための報告" aria-label="報告資料の題" /></label>
        <label className="block"><span className="label">読み手</span>
          <input className="input" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="例：役員・事業部長" aria-label="読み手" /></label>
        <label className="block"><span className="label">目的（何を判断・共有してほしいか）</span>
          <textarea className="input" rows={3} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="例：MVP の開発に進むかを決めてほしい" aria-label="目的" /></label>
        <div className="flex gap-3">
          <label className="block w-28"><span className="label">本文の枚数</span>
            <input type="number" min={3} max={30} className="input" value={slides} onChange={(e) => setSlides(Number(e.target.value) || 8)} /></label>
          <label className="block flex-1"><span className="label">使う中身</span>
            <select className="input" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="latest">最新版（なければ下書き）</option>
              <option value="draft">今の下書き</option>
            </select></label>
        </div>
        {error && <p className="text-[12px] text-rose-600">{error}</p>}
        <button className="btn-primary w-full" disabled={pending || !title.trim() || count === 0} onClick={submit}>
          <FileText size={14} />{pending ? "作っています…" : "報告資料を作る"}
        </button>
        <p className="text-[11px] leading-5 text-zinc-500">AI が選んだ項目だけを読んで、1枚1メッセージの構成にします。表・処理仕様（CRUD）・構成図は付録にそのまま付けます。できたら画面で直して PowerPoint か Markdown にできます。</p>
      </div>
    </div>
  );
}
