"use client";
import { useState, useTransition } from "react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import type { ResearchData, ResearchReport } from "@/lib/agent";
import { createReport, deleteReport, retryReport } from "@/app/(app)/research/actions";

type Kind = ResearchReport["kind"];
const LEAD: Record<Kind, string> = {
  tech: "テーマを支える技術要素と、それを定める規格・各社の開発者文書を読み解いた結果。要素を押すと各文書の扱い方を、文書を押すと構成要素と処理の流れを図で表示する。",
  industry: "テーマが広がる順に業界を並べ、業界ごとの規模・手続きの流れ・課題・事例・制度・障壁を整理した。",
  public: "官公庁などの公的な統計、テーマに関係する法令・指針・当局の発言、行政手続きのデジタル化の状況をまとめた。数字と日付は各出典から取った。",
};
const PLACE: Record<Kind, string> = { tech: "例：エージェントによる取引の技術", industry: "例：業界ごとの広がり", public: "例：公的統計と制度の動き" };
const BASIS: Record<string, string> = { search: "公開資料を検索して読んだ", knowledge: "検索が使えない接続のため、記事集と AI の知識から（出典を確かめてほしい）", stub: "スタブ（見本）" };

// ---------------- 技術調査 ----------------
type TComp = { id: string; name: string; lane: string; desc: string };
type TDoc = { id: string; title: string; org: string; kind: string; summary: string; urls: string[]; components: TComp[];
  flow: { step: number; src: string; dst: string; label: string }[]; elements: { code: string; how: string }[]; links: { to: string; rel: string }[] };
type Tech = { summary: string; elements: { code: string; name: string; desc: string }[]; docs: TDoc[] };

function Seq({ d }: { d: TDoc }) {
  const parts = d.components.filter((c) => d.flow.some((f) => f.src === c.id || f.dst === c.id));
  if (!parts.length) return null;
  const cw = 150, rh = 34, top = 64, W = 40 + parts.length * cw, H = top + d.flow.length * rh + 16;
  const X: Record<string, number> = {};
  parts.forEach((p, i) => { X[p.id] = 40 + cw / 2 + i * cw; });
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`${d.title}の処理の流れ`}>
        <defs><marker id={`ah-${d.id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#6366f1" /></marker></defs>
        {parts.map((p) => (
          <g key={p.id}>
            <line x1={X[p.id]} y1={50} x2={X[p.id]} y2={H - 8} stroke="#e4e4e7" strokeDasharray="4 3" />
            <rect x={X[p.id] - cw / 2 + 6} y={6} width={cw - 12} height={44} rx={6} fill="#f4f4f5" stroke="#d4d4d8"><title>{`${p.name}：${p.desc}`}</title></rect>
            <text x={X[p.id]} y={32} textAnchor="middle" fontSize="11" fontWeight="700" fill="#27272a">{p.name.length > 12 ? `${p.name.slice(0, 11)}…` : p.name}</text>
          </g>
        ))}
        {d.flow.map((f, i) => {
          const y = top + i * rh + 14, x1 = X[f.src], x2 = X[f.dst];
          if (x1 == null || x2 == null) return null;
          const lab = f.label.length > 22 ? `${f.label.slice(0, 21)}…` : f.label;
          return (
            <g key={i}>
              {x1 === x2
                ? <path d={`M${x1},${y} h30 v10 h-28`} fill="none" stroke="#6366f1" markerEnd={`url(#ah-${d.id})`} />
                : <line x1={x1} y1={y + 4} x2={x2 - Math.sign(x2 - x1) * 2} y2={y + 4} stroke="#6366f1" markerEnd={`url(#ah-${d.id})`} />}
              <text x={(x1 + x2) / 2 + (x1 === x2 ? 60 : 0)} y={y - 3} textAnchor="middle" fontSize="10.5" fill="#3f3f46"><title>{f.label}</title>{lab}</text>
              <circle cx={Math.min(x1, x2) - 14} cy={y + 4} r={8} fill="#6366f1" />
              <text x={Math.min(x1, x2) - 14} y={y + 7.5} textAnchor="middle" fontSize="9" fill="white">{f.step || i + 1}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function TechView({ t }: { t: Tech }) {
  const [sel, setSel] = useState<string>("");
  const doc = sel.startsWith("doc:") ? t.docs.find((d) => d.id === sel.slice(4)) : null;
  const el = sel.startsWith("el:") ? t.elements.find((e) => e.code === sel.slice(3)) : null;
  const n = (code: string) => t.docs.filter((d) => d.elements.some((e) => e.code === code)).length;
  const mx = Math.max(1, ...t.elements.map((e) => n(e.code)));
  const kinds = [...new Set(t.docs.map((d) => d.kind))];
  const lanes = (d: TDoc) => [...new Set(d.components.map((c) => c.lane))];
  // つながり：文書を円に並べ、使う・つながる相手を矢印で結ぶ
  const R = 150, C = 190, pos = Object.fromEntries(t.docs.map((d, i) => { const a = (i / Math.max(1, t.docs.length)) * Math.PI * 2 - Math.PI / 2; return [d.id, { x: C + R * Math.cos(a), y: C + R * Math.sin(a) }]; }));
  const deg = (id: string) => t.docs.reduce((s, d) => s + d.links.filter((l) => l.to === id).length, 0) + (t.docs.find((d) => d.id === id)?.links.length ?? 0);
  return (
    <div className="space-y-4">
      {t.summary && <p className="text-[13px] leading-relaxed">{t.summary}</p>}
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="card space-y-2 p-4">
          <h3 className="text-[13px] font-semibold">技術要素の全体像</h3>
          <p className="text-[11px] text-zinc-500">取引の流れに沿って{t.elements.length}の技術要素を並べた。棒はその要素を扱う文書の数（全{t.docs.length}件中）。押すと各文書の扱い方を表示する。</p>
          {t.elements.map((e) => (
            <button key={e.code} onClick={() => setSel(`el:${e.code}`)} className={`grid w-full grid-cols-[2.5rem_9rem_1fr_2rem] items-center gap-2 rounded px-1 py-0.5 text-left text-[12px] hover:bg-zinc-50 ${sel === `el:${e.code}` ? "bg-brand-50" : ""}`} title={e.desc}>
              <span className="font-mono text-[10px] text-zinc-400">{e.code}</span><span className="truncate">{e.name}</span>
              <span className="h-2.5 rounded-sm bg-zinc-100"><span className="block h-full rounded-sm bg-brand-500/80" style={{ width: `${(n(e.code) / mx) * 100}%` }} /></span>
              <span className="text-right tabular-nums">{n(e.code)}</span>
            </button>
          ))}
        </div>
        <div className="card space-y-2 p-4">
          <h3 className="text-[13px] font-semibold">文書どうしのつながり</h3>
          <p className="text-[11px] text-zinc-500">文書が「使う・つながる」と書いている相手を矢印で結んだ。点の大きさはつながりの数。点を押すと詳細を表示する。</p>
          <svg viewBox={`0 0 ${C * 2} ${C * 2}`} className="mx-auto w-full max-w-[380px]" role="img" aria-label="文書どうしのつながり">
            <defs><marker id="lnk" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#a1a1aa" /></marker></defs>
            {t.docs.flatMap((d) => d.links.filter((l) => pos[l.to]).map((l) => <line key={`${d.id}-${l.to}`} x1={pos[d.id].x} y1={pos[d.id].y} x2={pos[l.to].x} y2={pos[l.to].y} stroke="#d4d4d8" markerEnd="url(#lnk)"><title>{`${d.title} → ${l.rel}`}</title></line>))}
            {t.docs.map((d) => (
              <g key={d.id} className="cursor-pointer" onClick={() => setSel(`doc:${d.id}`)}>
                <circle cx={pos[d.id].x} cy={pos[d.id].y} r={6 + 2 * Math.sqrt(deg(d.id))} fill={sel === `doc:${d.id}` ? "#4f46e5" : "#818cf8"}><title>{d.title}</title></circle>
                <text x={pos[d.id].x} y={pos[d.id].y + 18} textAnchor="middle" fontSize="9.5" fill="#3f3f46">{d.title.split(/[（(]/)[0].slice(0, 14)}</text>
              </g>
            ))}
          </svg>
        </div>
      </div>
      <div className="card overflow-x-auto p-4">
        <h3 className="mb-2 text-[13px] font-semibold">文書 × 技術要素</h3>
        <p className="mb-2 text-[11px] text-zinc-500">点はその文書が要素を扱っていることを表す。行（文書名）か点を押すと、構成要素と流れの図を表示する。</p>
        <table className="text-[11px]">
          <thead><tr><th />{t.elements.map((e) => <th key={e.code} className="px-1 font-mono font-normal text-zinc-500" title={e.name}>{e.code}</th>)}</tr></thead>
          <tbody>
            {kinds.map((k) => [
              <tr key={k}><th colSpan={t.elements.length + 1} className="pt-2 text-left text-[11px] font-semibold text-zinc-500">{k}（{t.docs.filter((d) => d.kind === k).length}）</th></tr>,
              ...t.docs.filter((d) => d.kind === k).map((d) => (
                <tr key={d.id} className="border-t border-zinc-100">
                  <th className="cursor-pointer whitespace-nowrap pr-3 text-left font-normal hover:text-brand-700" onClick={() => setSel(`doc:${d.id}`)}>{d.title.split(/[（(]/)[0]}<small className="ml-1 text-zinc-400">{d.org.slice(0, 24)}</small></th>
                  {t.elements.map((e) => { const how = d.elements.find((x) => x.code === e.code)?.how; return <td key={e.code} className="px-1 text-center">{how ? <button onClick={() => setSel(`doc:${d.id}`)} title={how} className="inline-block h-2.5 w-2.5 rounded-full bg-brand-500" /> : <span className="text-zinc-200">·</span>}</td>; })}
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
      <div className="card space-y-3 p-4" aria-live="polite">
        {el ? (
          <>
            <h3 className="text-[14px] font-semibold"><span className="mr-2 font-mono text-zinc-400">{el.code}</span>{el.name}</h3>
            <p className="text-[12px] text-zinc-600">{el.desc}</p>
            <div className="space-y-1">
              {t.docs.filter((d) => d.elements.some((x) => x.code === el.code)).map((d) => (
                <div key={d.id} className="grid grid-cols-[12rem_1fr] gap-2 text-[12px]"><button onClick={() => setSel(`doc:${d.id}`)} className="truncate text-left text-brand-700 hover:underline">{d.title}</button><span>{d.elements.find((x) => x.code === el.code)?.how}</span></div>
              ))}
            </div>
          </>
        ) : doc ? (
          <>
            <h3 className="text-[14px] font-semibold">{doc.title}</h3>
            <div className="flex flex-wrap gap-1"><span className="chip">{doc.kind}</span><span className="chip">{doc.org}</span></div>
            <p className="text-[12px] leading-relaxed">{doc.summary}</p>
            <h4 className="text-[12px] font-semibold">構成要素（どこに何があるか）</h4>
            <div className="grid gap-2 md:grid-cols-3">
              {lanes(doc).map((l) => (
                <div key={l} className="rounded-lg bg-zinc-50 p-2"><h5 className="mb-1 text-[11px] font-semibold text-zinc-500">{l}</h5>
                  {doc.components.filter((c) => c.lane === l).map((c) => <div key={c.id} className="mb-1 rounded bg-white p-2 text-[11px]"><b className="block">{c.name}</b>{c.desc}</div>)}
                </div>
              ))}
            </div>
            <h4 className="text-[12px] font-semibold">主な処理の流れ</h4>
            <Seq d={doc} />
            <h4 className="text-[12px] font-semibold">扱っている技術要素</h4>
            <div className="space-y-1">{doc.elements.map((e) => <div key={e.code} className="grid grid-cols-[10rem_1fr] gap-2 text-[12px]"><button onClick={() => setSel(`el:${e.code}`)} className="truncate text-left text-brand-700 hover:underline">{e.code} {t.elements.find((x) => x.code === e.code)?.name}</button><span>{e.how}</span></div>)}</div>
            {doc.urls.length > 0 && <><h4 className="text-[12px] font-semibold">読んだページ</h4><ol className="list-decimal pl-5 text-[11px]">{doc.urls.map((u) => <li key={u}><a href={u} target="_blank" rel="noopener noreferrer" className="break-all text-brand-700 hover:underline">{u}</a></li>)}</ol></>}
          </>
        ) : <p className="text-[12px] text-zinc-500">技術要素か文書を選ぶと、ここに詳細を表示する。</p>}
      </div>
    </div>
  );
}

// ---------------- 業界調査 ----------------
type Ind = { name: string; order: number; size: string; size_source: string; flow: string[]; issues: string[]; cases: { text: string; url: string }[]; rules: { text: string; url: string }[]; barriers: string[] };
function IndustryView({ t }: { t: { summary: string; industries: Ind[] } }) {
  const L = (xs: { text: string; url: string }[]) => <ul className="list-disc space-y-0.5 pl-4">{xs.map((x, i) => <li key={i}>{x.url ? <a href={x.url} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">{x.text}</a> : x.text}</li>)}</ul>;
  return (
    <div className="space-y-4">
      {t.summary && <p className="text-[13px] leading-relaxed">{t.summary}</p>}
      <div className="flex flex-wrap items-center gap-1 text-[12px]">
        {[...t.industries].sort((a, b) => a.order - b.order).map((x, i) => <span key={x.name} className="flex items-center gap-1">{i > 0 && <span className="text-zinc-300">→</span>}<a href={`#ind-${i}`} className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-700">{x.order}. {x.name}</a></span>)}
      </div>
      {[...t.industries].sort((a, b) => a.order - b.order).map((x, i) => (
        <article key={x.name} id={`ind-${i}`} className="card scroll-mt-24 space-y-3 p-5 text-[12px]">
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-[12px] font-semibold text-white">{x.order}</span>
            <h3 className="text-[16px] font-semibold">{x.name}</h3>
            {x.size && <span className="ml-auto text-[13px]"><b>{x.size}</b>{x.size_source && <span className="text-[11px] text-zinc-500">（{x.size_source}）</span>}</span>}
          </div>
          {x.flow.length > 0 && (
            <div><h4 className="mb-1 font-semibold text-zinc-600">手続き・取引の流れ</h4>
              <div className="flex flex-wrap items-center gap-1">{x.flow.map((s, j) => <span key={j} className="flex items-center gap-1">{j > 0 && <span className="text-zinc-300">›</span>}<span className="rounded bg-zinc-100 px-2 py-1">{s}</span></span>)}</div>
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            {x.issues.length > 0 && <div><h4 className="mb-1 font-semibold text-zinc-600">課題</h4><ul className="list-disc space-y-0.5 pl-4">{x.issues.map((s, j) => <li key={j}>{s}</li>)}</ul></div>}
            {x.barriers.length > 0 && <div><h4 className="mb-1 font-semibold text-zinc-600">広がる上での障壁</h4><ul className="list-disc space-y-0.5 pl-4">{x.barriers.map((s, j) => <li key={j}>{s}</li>)}</ul></div>}
            {x.cases.length > 0 && <div><h4 className="mb-1 font-semibold text-zinc-600">事例</h4>{L(x.cases)}</div>}
            {x.rules.length > 0 && <div><h4 className="mb-1 font-semibold text-zinc-600">制度</h4>{L(x.rules)}</div>}
          </div>
        </article>
      ))}
    </div>
  );
}

// ---------------- 公的データ ----------------
type Stat = { title: string; unit: string; source: string; url: string; series: { period: string; value: number }[]; note: string };
type Pub = { summary: string; stats: Stat[]; rules: { date: string; title: string; org: string; body: string; url: string }[]; gov: { title: string; status: string; body: string; url: string }[] };
function Line({ s }: { s: Stat }) {
  const W = 420, H = 160, P = 30, vs = s.series.map((x) => x.value), lo = Math.min(0, ...vs), hi = Math.max(...vs, 1);
  const x = (i: number) => P + (i * (W - 2 * P)) / Math.max(1, s.series.length - 1), y = (v: number) => H - 22 - ((v - lo) / (hi - lo || 1)) * (H - 40);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${s.title}：${s.series.map((p) => `${p.period} ${p.value}${s.unit}`).join("、")}`}>
      <line x1={P} y1={H - 22} x2={W - P} y2={H - 22} stroke="#e4e4e7" />
      <polyline fill="none" stroke="#6366f1" strokeWidth="2" points={s.series.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")} />
      {s.series.map((p, i) => (
        <g key={p.period}>
          <circle cx={x(i)} cy={y(p.value)} r={3} fill="#6366f1"><title>{`${p.period}：${p.value.toLocaleString("ja-JP")}${s.unit}`}</title></circle>
          <text x={x(i)} y={y(p.value) - 7} textAnchor="middle" fontSize="9.5" fill="#3f3f46">{p.value.toLocaleString("ja-JP")}</text>
          <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="9.5" fill="#71717a">{p.period}</text>
        </g>
      ))}
    </svg>
  );
}
function PublicView({ t }: { t: Pub }) {
  const [v, setV] = useState<"stats" | "rules" | "gov">("stats");
  return (
    <div className="space-y-4">
      {t.summary && <p className="text-[13px] leading-relaxed">{t.summary}</p>}
      <nav className="flex gap-1">
        {([["stats", `公的統計（${t.stats.length}）`], ["rules", `制度・ルールの動き（${t.rules.length}）`], ["gov", `行政手続きのデジタル化（${t.gov.length}）`]] as const).map(([k, l]) => (
          <button key={k} aria-pressed={v === k} onClick={() => setV(k)} className={`rounded-full border px-3 py-1 text-[12px] ${v === k ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-600"}`}>{l}</button>
        ))}
      </nav>
      {v === "stats" && (
        <div className="grid gap-4 md:grid-cols-2">
          {t.stats.map((s, i) => (
            <div key={i} className="card space-y-1 p-4 text-[12px]">
              <h4 className="text-[13px] font-semibold">{s.title}<span className="ml-1 text-[11px] font-normal text-zinc-500">（{s.unit}）</span></h4>
              <Line s={s} />
              <p className="text-[11px] text-zinc-500">出典：{s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">{s.source}</a> : s.source}{s.note && `　${s.note}`}</p>
            </div>
          ))}
        </div>
      )}
      {v === "rules" && (
        <ol className="relative space-y-3 border-l border-zinc-200 pl-5">
          {[...t.rules].sort((a, b) => (a.date < b.date ? 1 : -1)).map((r, i) => (
            <li key={i} className="text-[12px]"><span className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full bg-brand-500" />
              <div className="text-[11px] tabular-nums text-zinc-500">{r.date}・{r.org}</div>
              <div className="font-semibold">{r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{r.title}</a> : r.title}</div>
              <p className="text-zinc-700">{r.body}</p>
            </li>
          ))}
        </ol>
      )}
      {v === "gov" && (
        <div className="space-y-2">
          {t.gov.map((g, i) => (
            <div key={i} className="card flex gap-3 p-3 text-[12px]">
              <span className={`chip h-fit shrink-0 ${/済|実施/.test(g.status) ? "border-emerald-200 text-emerald-700" : /進行/.test(g.status) ? "border-sky-200 text-sky-700" : ""}`}>{g.status}</span>
              <div><div className="font-semibold">{g.url ? <a href={g.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{g.title}</a> : g.title}</div><p className="text-zinc-700">{g.body}</p></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ReportsTab({ n, d, kind, label, canEdit }: { n: number; d: ResearchData; kind: Kind; label: string; canEdit: boolean }) {
  const list = d.reports.filter((r) => r.kind === kind);
  const [sel, setSel] = useState<number | null>(null);
  const [form, setForm] = useState(false);
  const [title, setTitle] = useState("");
  const [instr, setInstr] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const cur = list.find((r) => r.id === sel) ?? list[0] ?? null;
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <p className="min-w-0 flex-1 text-[13px] text-zinc-500">{LEAD[kind]}</p>
        {canEdit && <button className="btn-secondary btn-sm" onClick={() => setForm(!form)}><Plus size={13} />{label}のレポートを作る</button>}
      </div>
      {form && (
        <div className="card space-y-2 p-4">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={PLACE[kind]} aria-label="レポートの題" />
          <textarea className="input min-h-20 text-[12px]" value={instr} onChange={(e) => setInstr(e.target.value)} placeholder="何を調べるか（任意）：対象・観点・必ず入れたい規格や業界など" aria-label="指示" />
          <p className="text-[11px] text-zinc-500">AI が公開資料を（Gemini / Vertex AI の接続なら検索して）読み、形にまとめます。数分〜十数分かかります（ジョブで動きます）。</p>
          <div className="flex gap-2">
            <button disabled={pending} className="btn-primary btn-sm" onClick={() => start(async () => { const r = await createReport(n, kind, title, instr); if (r.error) setError(r.error); else { setForm(false); setTitle(""); setInstr(""); setSel(null); } })}>作る</button>
            <button className="btn-ghost btn-sm" onClick={() => setForm(false)}>取り消す</button>
            {error && <span className="text-xs text-rose-600">{error}</span>}
          </div>
        </div>
      )}
      {list.length === 0 ? <p className="text-sm text-zinc-400">まだ{label}のレポートがない。</p> : (
        <>
          {list.length > 1 && (
            <nav className="flex flex-wrap gap-1">
              {list.map((r) => <button key={r.id} onClick={() => setSel(r.id)} className={`rounded-full border px-3 py-1 text-[12px] ${cur?.id === r.id ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-600"}`}><span className="font-mono">{r.key}</span> {r.title}</button>)}
            </nav>
          )}
          {cur && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[16px] font-semibold"><span className="mr-2 font-mono text-[12px] text-zinc-400">{cur.key}</span>{cur.title}</h3>
                {cur.status === "done" && <span className="text-[11px] text-zinc-500">確認日 {cur.checked}・{BASIS[cur.basis] ?? ""}</span>}
                <div className="ml-auto flex items-center gap-2">
                  {cur.job_id && <a href={`/jobs/${cur.job_id}`} className="text-[12px] text-zinc-500 hover:underline">ジョブ</a>}
                  {canEdit && cur.status !== "queued" && cur.status !== "running" && <button disabled={pending} className="btn-ghost btn-sm" onClick={() => start(async () => { await retryReport(n, cur.id); })}><RotateCcw size={13} />作り直す</button>}
                  {canEdit && <button disabled={pending} className="btn-ghost btn-sm text-rose-600" onClick={() => { if (confirm(`${cur.key} を消しますか？`)) start(async () => { await deleteReport(n, cur.id); setSel(null); }); }}><Trash2 size={13} /></button>}
                </div>
              </div>
              {cur.instructions && <p className="text-[11px] text-zinc-500">指示：{cur.instructions}</p>}
              {(cur.status === "queued" || cur.status === "running") && <p className="rounded-md bg-sky-50 px-3 py-2 text-[12px] text-sky-800">AI が調べています。終わると自動で表示します。</p>}
              {cur.status === "failed" && <p className="rounded-md bg-rose-50 px-3 py-2 text-[12px] text-rose-700">作れませんでした：{cur.error}</p>}
              {cur.status === "done" && cur.data && (
                kind === "tech" ? <TechView t={cur.data as unknown as Tech} /> : kind === "industry" ? <IndustryView t={cur.data as unknown as { summary: string; industries: Ind[] }} /> : <PublicView t={cur.data as unknown as Pub} />
              )}
              {cur.sources.length > 0 && (
                <details className="text-[11px]"><summary className="cursor-pointer text-zinc-500">出典（{cur.sources.length}件）</summary>
                  <ol className="mt-1 list-decimal pl-5">{cur.sources.map((s) => <li key={s.u}><a href={s.u} target="_blank" rel="noopener noreferrer" className="break-all text-brand-700 hover:underline">{s.t || s.u}</a></li>)}</ol>
                </details>
              )}
            </div>
          )}
        </>
      )}
      <p className="text-[11px] text-zinc-400">仕様や制度は変わりやすいので、引用するときは出典の原文を確かめてほしい。</p>
    </section>
  );
}
