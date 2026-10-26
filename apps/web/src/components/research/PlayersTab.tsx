"use client";
import { useState, useTransition } from "react";
import { Plus, Sparkles } from "lucide-react";
import type { ResearchData, ResearchPlayer } from "@/lib/agent";
import type { Model } from "./model";
import { deletePlayer, savePlayer, suggestPlayers, type PlayerInput } from "@/app/(app)/research/actions";

const HOT = "#ef4444", WARM = "#f59e0b", COOL = "#60a5fa", NONE = "#d4d4d8";
const days = (d: string) => (d ? (Date.now() - Date.parse(`${d}T00:00:00+09:00`)) / 864e5 : Infinity);
const heat = (d: string) => { const x = days(d); return x <= 14 ? HOT : x <= 60 ? WARM : x < Infinity ? COOL : NONE; };
const lines = (s: string) => s.split(/[\n,、]/).map((x) => x.trim()).filter(Boolean);

function PlayerForm({ n, d, p, onDone }: { n: number; d: ResearchData; p: ResearchPlayer | null; onDone: () => void }) {
  const [v, setV] = useState({ name: p?.name ?? "", aliases: (p?.aliases ?? []).join("、"), layer: p?.layer ?? d.layers[0] ?? "", region: p?.region ?? "",
    role: p?.role ?? "", detail: p?.detail ?? "", stance: p?.stance ?? "", tags: (p?.tags ?? []).join("、") });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  const body: PlayerInput = { ...v, aliases: lines(v.aliases), tags: lines(v.tags) };
  return (
    <div className="card space-y-2 p-4 text-[12px]" role="group" aria-label="プレーヤー">
      <div className="grid gap-2 md:grid-cols-2">
        <label className="space-y-1">名前<input className="input h-8 text-[12px]" value={v.name} onChange={set("name")} /></label>
        <label className="space-y-1">記事の中での呼び方（、で区切る）<input className="input h-8 text-[12px]" value={v.aliases} onChange={set("aliases")} /></label>
        <label className="space-y-1">層<select className="input h-8 py-0 text-[12px]" value={v.layer} onChange={set("layer")}>{d.layers.map((l) => <option key={l}>{l}</option>)}</select></label>
        <label className="space-y-1">国（JP・US など）<input className="input h-8 text-[12px]" value={v.region} onChange={set("region")} /></label>
        <label className="space-y-1">姿勢<input className="input h-8 text-[12px]" value={v.stance} onChange={set("stance")} placeholder="推進・様子見・拒否 など" /></label>
        <label className="space-y-1">対応する規格・製品（、で区切る）<input className="input h-8 text-[12px]" value={v.tags} onChange={set("tags")} /></label>
        <label className="space-y-1 md:col-span-2">役割（1行）<input className="input h-8 text-[12px]" value={v.role} onChange={set("role")} /></label>
        <label className="space-y-1 md:col-span-2">詳しく<textarea className="input min-h-16 text-[12px]" value={v.detail} onChange={set("detail")} /></label>
      </div>
      <div className="flex gap-2">
        <button disabled={pending} className="btn-primary btn-sm" onClick={() => start(async () => { const r = await savePlayer(n, p?.id ?? null, body); if (r.error) setError(r.error); else onDone(); })}>保存</button>
        <button className="btn-ghost btn-sm" onClick={onDone}>取り消す</button>
        {error && <span className="text-rose-600">{error}</span>}
      </div>
    </div>
  );
}

export function PlayersTab({ n, d, M, canEdit }: { n: number; d: ResearchData; M: Model; canEdit: boolean }) {
  const [sel, setSel] = useState<number | null>(null);
  const [form, setForm] = useState<"new" | number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const arts = (p: ResearchPlayer) => M.arts.filter((a) => a.ent.includes(p.name));
  const last = (p: ResearchPlayer) => { const m = arts(p)[0]?.published ?? ""; const b = p.latest?.d ?? ""; return m > b ? m : b; };
  const by: Record<string, ResearchPlayer[]> = {};
  M.players.forEach((p) => { (by[p.layer || "（層なし）"] ??= []).push(p); });
  const order = [...d.layers, ...Object.keys(by).filter((l) => !d.layers.includes(l))];
  const cur = M.players.find((p) => p.id === sel) ?? null;
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[13px] text-zinc-500">主なプレーヤー{M.players.length}件を層ごとに並べ、記事集での登場を数える。日付は最後に記事に出た日。</p>
        <div className="flex flex-wrap gap-3 text-[11px] text-zinc-500">
          {[[HOT, "14日以内"], [WARM, "60日以内"], [COOL, "それより前"], [NONE, "記事なし"]].map(([c, l]) => <span key={l} className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />{l}</span>)}
          <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm border border-rose-200 bg-rose-50" />国内</span>
        </div>
        {canEdit && (
          <div className="ml-auto flex gap-2">
            <button disabled={pending} className="btn-secondary btn-sm" onClick={() => start(async () => { const r = await suggestPlayers(n); setMsg(r.error ?? `${r.count ?? 0}件を足しました`); })}>
              <Sparkles size={13} />{pending ? "探しています…" : "記事によく出る企業から足す"}
            </button>
            <button className="btn-secondary btn-sm" onClick={() => setForm("new")}><Plus size={13} />プレーヤーを足す</button>
          </div>
        )}
      </div>
      {msg && <p className="text-xs text-zinc-600">{msg}</p>}
      {form === "new" && <PlayerForm n={n} d={d} p={null} onDone={() => setForm(null)} />}
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-3">
          {M.players.length === 0 && <p className="text-sm text-zinc-400">プレーヤーがまだ登録されていない。「記事によく出る企業から足す」か「プレーヤーを足す」から。</p>}
          {order.filter((l) => by[l]).map((l) => (
            <div key={l} className="card p-3">
              <h4 className="mb-2 text-[12px] font-semibold text-zinc-600">{l}</h4>
              <div className="flex flex-wrap gap-1.5">
                {by[l].map((p) => {
                  const ld = last(p), n30 = arts(p).filter((a) => days(a.published ?? "") <= 30).length;
                  return (
                    <button key={p.id} type="button" aria-pressed={sel === p.id} onClick={() => setSel(sel === p.id ? null : p.id)}
                      className={`flex min-w-[9rem] flex-col items-start rounded-lg border px-2.5 py-1.5 text-left text-[12px] ${sel === p.id ? "border-brand-500 ring-1 ring-brand-500" : "border-zinc-200 hover:border-zinc-300"} ${p.region === "JP" ? "bg-rose-50/60" : "bg-white"}`}>
                      <span className="flex w-full items-center gap-1.5"><i className="h-2 w-2 shrink-0 rounded-full" style={{ background: heat(ld) }} /><b className="truncate">{p.name}</b><span className="ml-auto text-[10px] tabular-nums text-zinc-400">{ld ? ld.slice(2).replace(/-/g, "/") : "—"}</span></span>
                      <span className="text-[10px] text-zinc-500">{[n30 ? `30日で${n30}件` : "", p.stance, p.tags.join("・")].filter(Boolean).join(" · ")}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <aside className="card h-fit space-y-2 p-4 text-[12px] lg:sticky lg:top-20" aria-live="polite">
          {!cur ? <p className="text-zinc-500">プレーヤーを押すと、役割・最新の動き・関連記事を表示する。</p> : form === cur.id ? (
            <PlayerForm n={n} d={d} p={cur} onDone={() => setForm(null)} />
          ) : (
            <>
              <h5 className="text-[15px] font-semibold">{cur.name}</h5>
              <div className="flex flex-wrap gap-1">
                {cur.region && <span className={`chip ${cur.region === "JP" ? "border-rose-200 text-rose-700" : ""}`}>{cur.region}</span>}
                {cur.stance && <span className={`chip ${/拒否|反対/.test(cur.stance) ? "border-rose-200 text-rose-700" : ""}`}>{cur.stance}</span>}
                {cur.tags.map((t) => <span key={t} className="chip">{t}</span>)}
              </div>
              {cur.role && <p className="font-medium">{cur.role}</p>}
              {cur.detail && <p className="whitespace-pre-wrap text-zinc-600">{cur.detail}</p>}
              {cur.latest?.text && <><div className="pt-1 text-[11px] font-semibold text-zinc-500">最新の動き（{cur.latest.d}）</div><p>{cur.latest.text} {cur.latest.u && <a href={cur.latest.u} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">記事</a>}</p></>}
              <div className="pt-1 text-[11px] font-semibold text-zinc-500">記事集での登場 {arts(cur).length}件</div>
              {arts(cur).length ? (
                <ul className="space-y-1">{arts(cur).slice(0, 6).map((a) => <li key={a.key}><span className="tabular-nums text-zinc-400">{a.published}</span> <a href={a.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{a.head}</a></li>)}</ul>
              ) : <p className="text-zinc-400">記事集にはまだ出ていない。</p>}
              {cur.aliases.length > 0 && <p className="text-[11px] text-zinc-400">呼び方：{cur.aliases.join("・")}</p>}
              {canEdit && (
                <div className="flex gap-3 pt-1">
                  <button className="text-brand-700 hover:underline" onClick={() => setForm(cur.id)}>直す</button>
                  <button className="text-rose-600 hover:underline" onClick={() => { if (confirm(`「${cur.name}」を消しますか？`)) start(async () => { await deletePlayer(n, cur.id); setSel(null); }); }}>消す</button>
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
