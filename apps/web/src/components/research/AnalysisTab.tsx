"use client";
import { useMemo, useState, useTransition } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Download, Sparkles, X } from "lucide-react";
import type { ResearchData, ResearchFact } from "@/lib/agent";
import { AF0, type AF, type Art, type Dim, type Model, csvDownload, dims, heat, inAF, layerColor, pct, periods } from "./model";
import { Seg } from "./NewsTab";
import { analyze } from "@/app/(app)/research/actions";
import { ZoomPan } from "@/components/ZoomPan";

type Item = { k: string; l: string; n: number; s?: string; sx?: string; dot?: string; tip?: string };
type Drill = { t: string; keys: string[]; sub?: string } | null;
const uniq = <T,>(a: T[]) => [...new Set(a)];

function BarList({ items, onPick }: { items: Item[]; onPick?: (k: string) => void }) {
  const mx = Math.max(1, ...items.map((x) => x.n));
  if (!items.length) return <p className="text-[12px] text-zinc-400">データがない</p>;
  return (
    <div className="space-y-0.5">
      {items.map((x) => (
        <button key={x.k} type="button" title={x.tip ?? x.l} onClick={() => onPick?.(x.k)} className="grid w-full grid-cols-[10rem_1fr_auto] items-center gap-2 rounded px-1 py-0.5 text-left text-[12px] hover:bg-zinc-50">
          <span className="flex min-w-0 items-center gap-1.5 truncate text-zinc-700">{x.dot && <i className="h-2 w-2 shrink-0 rounded-full" style={{ background: x.dot }} />}<span className="truncate">{x.l}</span></span>
          <span className="h-2.5 rounded-sm bg-zinc-100"><span className="block h-full rounded-sm bg-brand-500/80" style={{ width: `${(x.n / mx) * 100}%` }} /></span>
          <span className="whitespace-nowrap text-right tabular-nums"><b>{x.n}</b>{x.s && <span className="text-zinc-500"> {x.s}</span>}{x.sx && <span className="text-[10px] text-zinc-400">　{x.sx}</span>}</span>
        </button>
      ))}
    </div>
  );
}

function Card({ title, note, children, right }: { title: string; note?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="card space-y-2 p-4">
      <div className="flex items-center gap-2"><h3 className="text-[13px] font-semibold">{title}</h3>{right && <span className="ml-auto">{right}</span>}</div>
      {note && <p className="text-[11px] text-zinc-500">{note}</p>}
      {children}
    </div>
  );
}

function Legend({ M }: { M: Model }) {
  const used = uniq(Object.values(M.entLayer));
  return <div className="flex flex-wrap gap-2 text-[10px] text-zinc-500">{M.layers.filter((l) => used.includes(l)).map((l) => <span key={l} className="flex items-center gap-1"><i className="h-2 w-2 rounded-full" style={{ background: layerColor(M.layers, l) }} />{l}</span>)}</div>;
}

// ---------------- 概要 ----------------
function Summary({ rows, M, d, drill }: { rows: Art[]; M: Model; d: ResearchData; drill: (t: string, keys: string[]) => void }) {
  const nJP = rows.filter((a) => a.jp).length, nOV = rows.length - nJP;
  const nf = rows.reduce((s, a) => s + (M.factsBy[a.key] ?? []).length, 0);
  const ents = uniq(rows.flatMap((a) => a.ent));
  const span = rows.length ? `${rows[rows.length - 1].m}〜${rows[0].m}` : "—";
  const by = (f: (a: Art) => string[]) => { const c: Record<string, string[]> = {}; rows.forEach((a) => uniq(f(a)).forEach((k) => (c[k] ??= []).push(a.key))); return c; };
  const iss = by((a) => a.iss), cat = by((a) => [a.category]), ent = by((a) => a.ent);
  const jpOf = (keys: string[]) => keys.filter((k) => M.byKey[k].jp).length;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[[rows.length, "記事"], [rows.length ? pct(nJP / rows.length) : "—", `国内の記事の割合（${nJP}件）`], [nf, "ファクト（数字）"], [ents.length, "登場した企業・団体"], [span, "期間"]].map(([v, l]) => (
          <div key={String(l)} className="card p-3"><div className="text-lg font-semibold tabular-nums">{v}</div><div className="text-[11px] text-zinc-500">{l}</div></div>
        ))}
      </div>
      {!rows.length ? <p className="text-sm text-zinc-400">条件に合う記事はない。</p> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="論点のランキング" note="記事に付けた論点（1記事につき最大3つ）の件数。割合は対象記事数に対する比。右は国内・海外それぞれの記事に占める割合。押すと記事を表示。">
            <BarList items={Object.keys(iss).sort((a, b) => iss[b].length - iss[a].length).map((k) => ({
              k, l: k, n: iss[k].length, s: pct(iss[k].length / rows.length), tip: M.issueQ[k],
              sx: `国内${nJP ? pct(jpOf(iss[k]) / nJP) : "—"}／海外${nOV ? pct((iss[k].length - jpOf(iss[k])) / nOV) : "—"}`,
            }))} onPick={(k) => drill(`論点：${k}`, iss[k])} />
          </Card>
          <div className="space-y-4">
            <Card title="区分" note="記事の主な担い手の種類（1記事1区分）。">
              <BarList items={Object.keys(cat).sort((a, b) => cat[b].length - cat[a].length).map((k) => ({ k, l: d.options.categories[k] ?? k, n: cat[k].length, s: pct(cat[k].length / rows.length) }))}
                onPick={(k) => drill(`区分：${d.options.categories[k] ?? k}`, cat[k])} />
            </Card>
            <Card title="よく出る企業・団体（上位15）" note="見出し・要約に名前が出た記事の数。色は層。">
              <Legend M={M} />
              <BarList items={Object.keys(ent).sort((a, b) => ent[b].length - ent[a].length).slice(0, 15).map((k) => ({ k, l: k, n: ent[k].length, s: pct(ent[k].length / rows.length), dot: layerColor(M.layers, M.entLayer[k]) }))}
                onPick={(k) => drill(`企業・団体：${k}`, ent[k])} />
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- 自由集計 ----------------
const DIM_KEYS = ["iss", "iss1", "cat", "reg", "cty", "y", "q", "m", "ent", "grp", "fk", "ft", "hasf", "memo", "qa"];
function order(D: Dim, tot: Record<string, number>) {
  const ks = Object.keys(tot);
  return D.time ? ks.sort() : ks.sort((a, b) => tot[b] - tot[a] || (a < b ? -1 : 1));
}
function Pivot({ rows, M, DIMS, drill, name }: { rows: Art[]; M: Model; DIMS: Record<string, Dim>; drill: (t: string, keys: string[], sub?: string) => void; name: string }) {
  const [pr, setPr] = useState("iss");
  const [pc, setPc] = useState("reg");
  const [pm, setPm] = useState<"art" | "fact">("art");
  const [pv, setPv] = useState<"n" | "row" | "col">("n");
  const R = DIMS[pr], C = pc ? DIMS[pc] : null;
  const P = useMemo(() => {
    const recs: { a: Art; f: ResearchFact | null }[] = pm === "fact" ? rows.flatMap((a) => (M.factsBy[a.key] ?? []).map((f) => ({ a, f }))) : rows.map((a) => ({ a, f: null }));
    const cell: Record<string, string[]> = {}, rt: Record<string, string[]> = {}, ct: Record<string, string[]> = {};
    recs.forEach((x) => {
      const rv = uniq(R.f(x.a, x.f, M)), cv = C ? uniq(C.f(x.a, x.f, M)) : ["計"];
      rv.forEach((r) => (rt[r] ??= []).push(x.a.key));
      cv.forEach((c) => (ct[c] ??= []).push(x.a.key));
      rv.forEach((r) => cv.forEach((c) => (cell[`${r}\u0001${c}`] ??= []).push(x.a.key)));
    });
    const cnt = (o: Record<string, string[]>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.length]));
    let rk = order(R, cnt(rt)), ck = C ? order(C, cnt(ct)) : ["計"];
    const cut = { r: 0, c: 0 };
    const rmax = R.top ?? 60, cmax = C?.top ?? 40;
    if (rk.length > rmax) { cut.r = rk.length - rmax; rk = rk.slice(0, rmax); }
    if (ck.length > cmax) { cut.c = ck.length - cmax; ck = ck.slice(0, cmax); }
    return { recs, cell, rt, ct, rk, ck, cut };
  }, [rows, M, R, C, pm]);
  const val = (r: string, c: string) => {
    const v = P.cell[`${r}\u0001${c}`]?.length ?? 0;
    return pv === "row" ? v / (P.rt[r]?.length || 1) : pv === "col" ? v / (P.ct[c]?.length || 1) : v;
  };
  const mx = Math.max(0, ...P.rk.flatMap((r) => P.ck.map((c) => val(r, c))));
  const unit = pm === "fact" ? "ファクト" : "記事";
  const sel = (v: string, set: (v: string) => void, none = false) => (
    <select value={v} onChange={(e) => set(e.target.value)} className="input h-8 w-44 py-0 text-[12px]">
      {none && <option value="">（なし）</option>}{DIM_KEYS.map((k) => <option key={k} value={k}>{DIMS[k].l}</option>)}
    </select>
  );
  return (
    <Card title="自由集計" right={
      <button className="btn-secondary btn-sm" onClick={() => csvDownload(`${name}_集計_${R.l}${C ? `×${C.l}` : ""}.csv`, [
        [`${R.l}${C ? ` ＼ ${C.l}` : ""}`, ...P.ck, ...(C ? ["計"] : [])],
        ...P.rk.map((r) => [r, ...P.ck.map((c) => P.cell[`${r}\u0001${c}`]?.length ?? 0), ...(C ? [P.rt[r]?.length ?? 0] : [])]),
      ])}><Download size={13} />CSVで保存</button>
    }>
      <div className="flex flex-wrap items-center gap-3 text-[12px]">
        <label className="flex items-center gap-1">縦の軸 {sel(pr, setPr)}</label>
        <label className="flex items-center gap-1">横の軸 {sel(pc, setPc, true)}</label>
        <label className="flex items-center gap-1">数える単位
          <select value={pm} onChange={(e) => setPm(e.target.value as "art" | "fact")} className="input h-8 w-36 py-0 text-[12px]"><option value="art">記事</option><option value="fact">ファクト（数字）</option></select>
        </label>
        <label className="flex items-center gap-1">表示
          <select value={pv} onChange={(e) => setPv(e.target.value as "n" | "row" | "col")} className="input h-8 w-36 py-0 text-[12px]"><option value="n">件数</option><option value="row">行の中の割合</option><option value="col">列の中の割合</option></select>
        </label>
      </div>
      <p className="text-[11px] text-zinc-500">
        対象：{P.recs.length}{unit}。セルを押すと該当する記事を表示する。
        {(R.multi || C?.multi) && `「${[R, C].filter((x) => x?.multi).map((x) => x!.l).join("」「")}」は1件が複数の値に入るため、行・列の合計は「計」より大きくなる。`}
        {P.cut.r > 0 && `縦は件数の多い順に${P.rk.length}行まで表示（ほか${P.cut.r}行）。`}{P.cut.c > 0 && `横は${P.ck.length}列まで（ほか${P.cut.c}列）。`}
      </p>
      {!rows.length ? <p className="text-sm text-zinc-400">条件に合う記事はない。</p> : (
        <div className="max-h-[560px] overflow-auto">
          <table className="text-[11px]">
            <thead className="sticky top-0 bg-white">
              <tr><th className="sticky left-0 bg-white px-2 py-1 text-left">{R.l}{C && ` ＼ ${C.l}`}</th>{P.ck.map((c) => <th key={c} className="px-2 py-1 text-right font-medium">{C ? c : "件数"}</th>)}{C && <th className="px-2 py-1 text-right">計</th>}</tr>
            </thead>
            <tbody>
              {P.rk.map((r) => (
                <tr key={r} className="border-t border-zinc-100">
                  <th className="sticky left-0 max-w-[14rem] truncate bg-white px-2 py-1 text-left font-normal" title={M.issueQ[r] ?? r}>{r}</th>
                  {P.ck.map((c) => {
                    const keys = P.cell[`${r}\u0001${c}`] ?? [], v = val(r, c);
                    return <td key={c} tabIndex={0} onClick={() => keys.length && drill(`${r}${C ? ` × ${c}` : ""}`, keys, pm === "fact" ? "ファクトのある記事" : "")}
                      className={`cursor-pointer px-2 py-1 text-right tabular-nums ${keys.length ? "" : "text-zinc-300"}`} style={heat(v, mx)} title={`${r}${C ? ` × ${c}` : ""}：${keys.length}${unit}`}>
                      {pv === "n" ? keys.length : keys.length ? pct(v) : "0"}
                    </td>;
                  })}
                  {C && <td className="cursor-pointer bg-zinc-50 px-2 py-1 text-right tabular-nums" onClick={() => drill(r, P.rt[r] ?? [])}>{P.rt[r]?.length ?? 0}</td>}
                </tr>
              ))}
              {C && (
                <tr className="border-t border-zinc-200 bg-zinc-50">
                  <th className="sticky left-0 bg-zinc-50 px-2 py-1 text-left">計</th>
                  {P.ck.map((c) => <td key={c} className="cursor-pointer px-2 py-1 text-right tabular-nums" onClick={() => drill(c, P.ct[c] ?? [])}>{P.ct[c]?.length ?? 0}</td>)}
                  <td className="px-2 py-1 text-right tabular-nums">{P.recs.length}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---------------- 推移と増減 ----------------
function Trend({ rows, M, DIMS, drill }: { rows: Art[]; M: Model; DIMS: Record<string, Dim>; drill: (t: string, keys: string[]) => void }) {
  const [td, setTd] = useState("iss");
  const [tg, setTg] = useState<"q" | "m">("q");
  const [tm, setTm] = useState<"n" | "s">("n");
  const [tw, setTw] = useState(6);
  const D = DIMS[td];
  const per = periods(rows, tg);
  const pk = (a: Art) => (tg === "q" ? a.q : a.m);
  const tot: Record<string, number> = {}, cnt: Record<string, string[]> = {}, rt: Record<string, number> = {};
  rows.forEach((a) => { const p = pk(a); tot[p] = (tot[p] ?? 0) + 1; uniq(D.f(a, null, M)).forEach((k) => { rt[k] = (rt[k] ?? 0) + 1; (cnt[`${k}\u0001${p}`] ??= []).push(a.key); }); });
  const skip = new Set(["（該当なし）", "ファクトなし", "（論点なし）"]);
  let rk = Object.keys(rt).filter((k) => !skip.has(k)).sort((a, b) => rt[b] - rt[a]);
  if (td === "ent") rk = rk.slice(0, 20);
  const v = (k: string, p: string) => { const n = cnt[`${k}\u0001${p}`]?.length ?? 0; return tm === "s" ? n / (tot[p] || 1) : n; };
  const mx = Math.max(0, ...rk.flatMap((k) => per.map((p) => v(k, p))));
  // 増えた・減った：直近 tw か月と、その前の tw か月で、記事に占める割合の差
  const last = rows[0]?.m ?? "";
  const back = (n: number) => { let y = Number(last.slice(0, 4)), m = Number(last.slice(5, 7)) - n; while (m < 1) { m += 12; y--; } return `${y}-${String(m).padStart(2, "0")}`; };
  const rS = back(tw - 1), pE = back(tw), pS = back(2 * tw - 1);
  const rec = rows.filter((a) => a.m >= rS && a.m <= last), prv = rows.filter((a) => a.m >= pS && a.m <= pE);
  const cR: Record<string, string[]> = {}, cP: Record<string, number> = {};
  rec.forEach((a) => uniq(D.f(a, null, M)).forEach((k) => (cR[k] ??= []).push(a.key)));
  prv.forEach((a) => uniq(D.f(a, null, M)).forEach((k) => { cP[k] = (cP[k] ?? 0) + 1; }));
  let L = uniq([...Object.keys(cR), ...Object.keys(cP)]).filter((k) => !skip.has(k)).map((k) => {
    const a = (cR[k]?.length ?? 0) / (rec.length || 1), b = (cP[k] ?? 0) / (prv.length || 1);
    return { k, d: a - b, a, b, nr: cR[k]?.length ?? 0, np: cP[k] ?? 0 };
  }).sort((x, y) => y.d - x.d);
  if (td === "ent") L = L.filter((x) => x.nr + x.np >= 2);
  const md = Math.max(0.01, ...L.map((x) => Math.abs(x.d)));
  const TD = ["iss", "cat", "reg", "ent", "grp", "fk", "ft"];
  return (
    <div className="space-y-4">
      <Card title="推移">
        <div className="flex flex-wrap items-center gap-3 text-[12px]">
          <label className="flex items-center gap-1">分ける軸 <select value={td} onChange={(e) => setTd(e.target.value)} className="input h-8 w-44 py-0 text-[12px]">{TD.map((k) => <option key={k} value={k}>{DIMS[k].l}</option>)}</select></label>
          <label className="flex items-center gap-1">区切り <select value={tg} onChange={(e) => setTg(e.target.value as "q" | "m")} className="input h-8 w-28 py-0 text-[12px]"><option value="q">四半期</option><option value="m">月</option></select></label>
          <label className="flex items-center gap-1">表示 <select value={tm} onChange={(e) => setTm(e.target.value as "n" | "s")} className="input h-8 w-56 py-0 text-[12px]"><option value="n">件数</option><option value="s">その期間の記事に占める割合</option></select></label>
        </div>
        {!rows.length ? <p className="text-sm text-zinc-400">条件に合う記事はない。</p> : (
          <div className="overflow-x-auto">
            <table className="text-[11px]">
              <thead><tr><th className="sticky left-0 bg-white px-2 py-1 text-left">{D.l}</th>{per.map((p) => <th key={p} className="px-1.5 py-1 text-right font-medium">{tg === "q" ? p.slice(2).replace(" ", "") : p.slice(2).replace("-", "/")}</th>)}<th className="px-2 py-1 text-right">計</th></tr></thead>
              <tbody>
                <tr className="bg-zinc-50"><th className="sticky left-0 bg-zinc-50 px-2 py-1 text-left">記事数</th>{per.map((p) => <td key={p} className="px-1.5 py-1 text-right tabular-nums">{tot[p] ?? 0}</td>)}<td className="px-2 py-1 text-right">{rows.length}</td></tr>
                {rk.map((k) => (
                  <tr key={k} className="border-t border-zinc-100">
                    <th className="sticky left-0 max-w-[14rem] truncate bg-white px-2 py-1 text-left font-normal" title={M.issueQ[k] ?? k}>{k}</th>
                    {per.map((p) => { const keys = cnt[`${k}\u0001${p}`] ?? [], x = v(k, p); return <td key={p} onClick={() => keys.length && drill(`${k}（${p}）`, keys)} className={`cursor-pointer px-1.5 py-1 text-right tabular-nums ${keys.length ? "" : "text-zinc-300"}`} style={heat(x, mx)}>{tm === "n" ? keys.length : keys.length ? pct(x) : "0"}</td>; })}
                    <td className="bg-zinc-50 px-2 py-1 text-right tabular-nums">{rt[k]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-zinc-500">期間ごとの記事数は集めた量で変わるので、比べるときは「割合」表示を使う。記事数の少ない期間（目安10件未満）の割合はぶれやすい。最新の期間は途中まで。</p>
      </Card>
      <Card title="増えた・減った">
        <label className="flex items-center gap-1 text-[12px]">比べる長さ
          <select value={tw} onChange={(e) => setTw(Number(e.target.value))} className="input h-8 w-64 py-0 text-[12px]">
            {[3, 6, 12].map((w) => <option key={w} value={w}>直近{w}か月とその前の{w}か月</option>)}
          </select>
        </label>
        <p className="text-[11px] text-zinc-500">直近（{rS}〜{last}、{rec.length}件）と、その前（{pS}〜{pE}、{prv.length}件）で、記事に占める割合の差（ポイント）。右に伸びると増加、左は減少。両方で3件未満のものは薄く表示。</p>
        {!rec.length || !prv.length ? <p className="text-sm text-zinc-400">比べる期間に記事がない。期間の条件を広げてほしい。</p> : (
          <div className="space-y-0.5">
            {L.map((x) => (
              <button key={x.k} onClick={() => drill(`${x.k}（直近${tw}か月）`, cR[x.k] ?? [])} className={`grid w-full grid-cols-[10rem_1fr_1fr_7rem] items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] hover:bg-zinc-50 ${x.nr + x.np < 3 ? "opacity-50" : ""}`}>
                <span className="truncate">{x.k}</span>
                <span className="flex justify-end">{x.d < 0 && <i className="block h-2.5 rounded-l bg-rose-400" style={{ width: `${(Math.abs(x.d) / md) * 100}%` }} />}</span>
                <span>{x.d > 0 && <i className="block h-2.5 rounded-r bg-emerald-500" style={{ width: `${(x.d / md) * 100}%` }} />}</span>
                <span className="text-right tabular-nums">{x.d >= 0 ? "+" : ""}{(x.d * 100).toFixed(1)}pt <span className="text-zinc-400">{pct(x.b)}→{pct(x.a)}</span></span>
              </button>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------- 企業・プレーヤー ----------------
function Network({ rows, M, names, onPick, sel }: { rows: Art[]; M: Model; names: string[]; onPick: (n: string) => void; sel: string }) {
  const W = 900, H = 520, N = names.length;
  const { P, edges, rad, cnt } = useMemo(() => {
    const idx: Record<string, number> = {};
    names.forEach((n, i) => { idx[n] = i; });
    const cnt = names.map((n) => rows.filter((a) => a.ent.includes(n)).length);
    const E: Record<string, number> = {};
    rows.forEach((a) => {
      const es = a.ent.filter((n) => idx[n] != null);
      for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) {
        const [x, y] = [idx[es[i]], idx[es[j]]].sort((p, q) => p - q);
        E[`${x}-${y}`] = (E[`${x}-${y}`] ?? 0) + 1;
      }
    });
    const edges = Object.entries(E).filter(([, w]) => w >= 2).map(([k, w]) => { const [a, b] = k.split("-").map(Number); return { a, b, w }; });
    const mc = Math.max(1, ...cnt), mw = Math.max(1, ...edges.map((e) => e.w));
    const rad = cnt.map((c) => 6 + 16 * Math.sqrt(c / mc));
    // 力学モデルで配置（同じ記事に一緒に出る組ほど近く）。同じ並びなら毎回同じ形になる
    const P = names.map((n, i) => { const g = M.layers.indexOf(M.entLayer[n]); const ang = (g < 0 ? 0 : g) * 0.9 + i * 0.37; return { x: W / 2 + Math.cos(ang) * (150 + (i % 5) * 22), y: H / 2 + Math.sin(ang) * (120 + (i % 7) * 14) }; });
    const k = Math.sqrt((W * H) / Math.max(N, 1)) * 0.55;
    for (let it = 0; it < 300; it++) {
      const temp = 40 * (1 - it / 300) + 1, dx = new Array(N).fill(0), dy = new Array(N).fill(0);
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
        const ex = P[i].x - P[j].x, ey = P[i].y - P[j].y, dd = Math.hypot(ex, ey) || 0.01; let f = (k * k) / dd;
        const mn = rad[i] + rad[j] + 18; if (dd < mn) f += (mn - dd) * 3;
        dx[i] += (ex / dd) * f; dy[i] += (ey / dd) * f; dx[j] -= (ex / dd) * f; dy[j] -= (ey / dd) * f;
      }
      edges.forEach((e) => { const ex = P[e.a].x - P[e.b].x, ey = P[e.a].y - P[e.b].y, dd = Math.hypot(ex, ey) || 0.01, f = ((dd * dd) / k) * (0.4 + (0.6 * e.w) / mw); dx[e.a] -= (ex / dd) * f; dy[e.a] -= (ey / dd) * f; dx[e.b] += (ex / dd) * f; dy[e.b] += (ey / dd) * f; });
      for (let i = 0; i < N; i++) {
        dx[i] += (W / 2 - P[i].x) * 0.6; dy[i] += (H / 2 - P[i].y) * 0.9;
        const l = Math.hypot(dx[i], dy[i]) || 1;
        P[i].x = Math.max(rad[i] + 40, Math.min(W - rad[i] - 40, P[i].x + (dx[i] / l) * Math.min(l, temp)));
        P[i].y = Math.max(rad[i] + 14, Math.min(H - rad[i] - 14, P[i].y + (dy[i] / l) * Math.min(l, temp)));
      }
    }
    return { P, edges: edges.map((e) => ({ ...e, sw: 1 + (4 * e.w) / mw })), rad, cnt };
  }, [rows, M, names, N]);
  const [hov, setHov] = useState<number | null>(null);
  if (N < 2) return <p className="text-[12px] text-zinc-400">表示できる関係がない。</p>;
  const on = (i: number) => hov === i || (hov != null && edges.some((e) => (e.a === hov && e.b === i) || (e.b === hov && e.a === i)));
  return (
    <ZoomPan width={W} height={H} label="企業・団体の関係図">
      <g onMouseLeave={() => setHov(null)}>
      {edges.map((e) => <line key={`${e.a}-${e.b}`} x1={P[e.a].x} y1={P[e.a].y} x2={P[e.b].x} y2={P[e.b].y} strokeWidth={e.sw} stroke={hov != null && (e.a === hov || e.b === hov) ? "#6366f1" : "#d4d4d8"} opacity={hov != null && !(e.a === hov || e.b === hov) ? 0.25 : 0.9}><title>{`${names[e.a]} と ${names[e.b]}：${e.w}記事`}</title></line>)}
      {names.map((n, i) => (
        <g key={n} onMouseEnter={() => setHov(i)} onClick={() => onPick(n)} className="cursor-pointer" opacity={hov != null && !on(i) ? 0.3 : 1}>
          <circle cx={P[i].x} cy={P[i].y} r={rad[i]} fill={layerColor(M.layers, M.entLayer[n])} stroke={sel === n ? "#18181b" : "white"} strokeWidth={sel === n ? 3 : 1.5}><title>{`${n}：${cnt[i]}記事`}</title></circle>
          <text x={P[i].x} y={P[i].y + rad[i] + 11} textAnchor="middle" fontSize="10.5" fill="#3f3f46">{n}</text>
        </g>
      ))}
      </g>
    </ZoomPan>
  );
}

function Entities({ rows, M, drill }: { rows: Art[]; M: Model; drill: (t: string, keys: string[]) => void }) {
  const c: Record<string, string[]> = {};
  rows.forEach((a) => a.ent.forEach((n) => (c[n] ??= []).push(a.key)));
  const names = Object.keys(c).sort((a, b) => c[b].length - c[a].length || (a < b ? -1 : 1));
  const [esel, setEsel] = useState("");
  const cur = c[esel] ? esel : names[0];
  if (!names.length) return <p className="text-sm text-zinc-400">条件に合う記事に、企業・団体は出てこない。</p>;
  const my = rows.filter((a) => a.ent.includes(cur));
  const per = periods(rows, "q"), pc: Record<string, number> = {};
  my.forEach((a) => { pc[a.q] = (pc[a.q] ?? 0) + 1; });
  const pm = Math.max(1, ...Object.values(pc));
  const ic: Record<string, number> = {}, co: Record<string, number> = {};
  my.forEach((a) => { a.issues.forEach((k) => { ic[k] = (ic[k] ?? 0) + 1; }); a.ent.forEach((m) => { if (m !== cur) co[m] = (co[m] ?? 0) + 1; }); });
  const jp = my.filter((a) => a.jp).length;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="登場の多い企業・団体" note="見出し・要約に名前が出た記事の数（上位50）。押すと右に詳細。">
          <Legend M={M} />
          <div className="max-h-[520px] overflow-y-auto">
            <BarList items={names.slice(0, 50).map((n) => ({ k: n, l: n, n: c[n].length, s: `国内${c[n].filter((k) => M.byKey[k].jp).length}`, dot: layerColor(M.layers, M.entLayer[n]) }))} onPick={setEsel} />
          </div>
        </Card>
        <Card title={cur} right={<button className="text-[12px] text-brand-700 hover:underline" onClick={() => drill(`企業・団体：${cur}`, c[cur])}>記事を一覧</button>}>
          <p className="text-[11px] text-zinc-500"><i className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: layerColor(M.layers, M.entLayer[cur]) }} />{M.entLayer[cur]}・{my.length}記事（国内{jp}・海外{my.length - jp}）</p>
          <h4 className="text-[12px] font-semibold">四半期ごとの記事数</h4>
          <div className="flex h-12 items-end gap-0.5" role="img" aria-label={per.map((p) => `${p} ${pc[p] ?? 0}件`).join("、")}>
            {per.map((p) => <i key={p} title={`${p}：${pc[p] ?? 0}件`} className="block flex-1 rounded-t bg-brand-300" style={{ height: `${((pc[p] ?? 0) / pm) * 100}%`, minHeight: 1 }} />)}
          </div>
          <h4 className="text-[12px] font-semibold">論点の内訳</h4>
          <BarList items={Object.keys(ic).sort((a, b) => ic[b] - ic[a]).map((k) => ({ k, l: k, n: ic[k], s: pct(ic[k] / my.length) }))} />
          <h4 className="text-[12px] font-semibold">一緒に出ることが多い企業・団体</h4>
          <BarList items={Object.keys(co).sort((a, b) => co[b] - co[a]).slice(0, 10).map((m) => ({ k: m, l: m, n: co[m], dot: layerColor(M.layers, M.entLayer[m]) }))} onPick={setEsel} />
          <h4 className="text-[12px] font-semibold">最近の記事</h4>
          <ol className="list-decimal space-y-0.5 pl-5 text-[12px]">{my.slice(0, 6).map((a) => <li key={a.key}><span className="tabular-nums text-zinc-400">{a.published}</span> <a href={a.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{a.head}</a></li>)}</ol>
        </Card>
      </div>
      <Card title="企業・団体の関係図" note="登場の多い30社・団体を点で、同じ記事に2回以上一緒に出た組み合わせを線で表す。点の大きさは記事数、線の太さは一緒に出た記事数。点に触れるとつながりを強調し、押すと上に詳細を出す。">
        <Network rows={rows} M={M} names={names.slice(0, 30)} onPick={setEsel} sel={cur} />
      </Card>
    </div>
  );
}

// ---------------- AI に分析を頼む ----------------
function Ask({ n, d, M, f, count }: { n: number; d: ResearchData; M: Model; f: AF; count: number }) {
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const filters: Record<string, string> = {};
  if (f.q) filters.q = f.q;
  if (f.reg !== "all") filters.region = f.reg === "jp" ? "domestic" : "overseas";
  if (f.cat) filters.category = f.cat;
  if (f.iss) filters.issue = f.iss;
  if (f.ent) filters.entity = f.ent;
  if (f.from) filters.from = `${f.from}-01`;
  if (f.to) filters.to = `${f.to}-31`;
  // 本文の RA-n を記事へのリンクにする
  const link = (md: string) => md.replace(/\b(RA)-(\d+)\b/g, (m, _k, num) => { const a = M.byNum[Number(num)]; return a ? `[${m}](${a.url})` : m; });
  return (
    <div className="space-y-4">
      <Card title="AI に分析を頼む" note={`いま絞り込んでいる記事 ${count}件とそのファクトだけを根拠に、記事番号つきのレポートを書く。`}>
        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} className="input flex-1" placeholder="問い（任意）例：利用は広がっているか。何が妨げか" aria-label="問い" />
          <button disabled={pending || !count} className="btn-brand btn-sm" onClick={() => start(async () => { const r = await analyze(n, q, filters); if (r.error) setError(r.error); else { setQ(""); setError(null); } })}>
            <Sparkles size={13} />{pending ? "書いています…" : "分析する"}
          </button>
        </div>
        {error && <p className="text-xs text-rose-600">{error}</p>}
      </Card>
      {d.analyses.map((a) => (
        <div key={a.id} className="card space-y-2 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[14px] font-semibold">{a.title}</h3>
            {Object.entries(a.filters ?? {}).map(([k, v]) => <span key={k} className="chip">{k}：{v}</span>)}
            <span className="ml-auto text-[11px] text-zinc-400">{a.created_by}・{new Date(a.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</span>
          </div>
          <div className="prose-md"><Markdown remarkPlugins={[remarkGfm]} components={{ a: (p) => <a {...p} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline" /> }}>{link(a.body)}</Markdown></div>
        </div>
      ))}
    </div>
  );
}

export function AnalysisTab({ n, d, M }: { n: number; d: ResearchData; M: Model }) {
  const [f, setF] = useState<AF>(AF0);
  const [sub, setSub] = useState<"sum" | "pivot" | "trend" | "ent" | "ask">("sum");
  const [drill, setDrill] = useState<Drill>(null);
  const DIMS = useMemo(() => dims({ cat: d.options.categories, kind: d.options.fact_kinds }, { memo: (a) => !!a.memo, qa: (a) => !!(d.questions[a.key] ?? []).length }), [d]);
  const rows = M.arts.filter((a) => inAF(a, f));
  const set = (patch: Partial<AF>) => { setF({ ...f, ...patch }); setDrill(null); };
  const ec: Record<string, number> = {};
  M.arts.forEach((a) => a.ent.forEach((e) => { ec[e] = (ec[e] ?? 0) + 1; }));
  const scope = [f.from || f.to ? `${f.from || "最初"}〜${f.to || "最新"}` : "", f.reg !== "all" ? (f.reg === "jp" ? "国内" : "海外") : "",
    f.cat ? `区分＝${d.options.categories[f.cat] ?? f.cat}` : "", f.iss ? `論点＝${f.iss}` : "", f.ent ? `企業＝${f.ent}` : "", f.q ? `キーワード「${f.q}」` : ""].filter(Boolean).join("・") || "全記事";
  const open = (t: string, keys: string[], s?: string) => { setDrill({ t, keys: uniq(keys), sub: s }); setTimeout(() => document.getElementById("drill")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0); };
  const dl = drill ? drill.keys.map((k) => M.byKey[k]).filter(Boolean).sort((a, b) => ((a.published ?? "") < (b.published ?? "") ? 1 : -1)) : [];
  return (
    <section className="space-y-4">
      <p className="text-[13px] text-zinc-500">記事を、期間・地域・区分・論点・企業・ファクトの角度から集計する。下の条件は全部の分析に効く。1つの記事は複数の論点・企業に入るので、内訳の合計は記事数より多くなることがある。</p>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white p-3" role="search" aria-label="分析の対象">
        <span className="text-[12px] text-zinc-500">期間</span>
        <select value={f.from} onChange={(e) => set({ from: e.target.value })} aria-label="開始月" className="input h-8 w-28 py-0 text-[12px]"><option value="">最初から</option>{M.months.map((m) => <option key={m} value={m}>{m.replace("-", "/")}</option>)}</select>
        <span className="text-[12px] text-zinc-500">〜</span>
        <select value={f.to} onChange={(e) => set({ to: e.target.value })} aria-label="終了月" className="input h-8 w-28 py-0 text-[12px]"><option value="">最新まで</option>{M.months.map((m) => <option key={m} value={m}>{m.replace("-", "/")}</option>)}</select>
        <Seg value={f.reg} items={[["all", "すべて"], ["jp", "国内"], ["ov", "海外"]]} onChange={(v) => set({ reg: v })} />
        <select value={f.cat} onChange={(e) => set({ cat: e.target.value })} aria-label="区分" className="input h-8 w-32 py-0 text-[12px]"><option value="">区分：すべて</option>{Object.entries(d.options.categories).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select value={f.iss} onChange={(e) => set({ iss: e.target.value })} aria-label="論点" className="input h-8 w-40 py-0 text-[12px]"><option value="">論点：すべて</option>{M.issues.map((k) => <option key={k} value={k}>{k}</option>)}</select>
        <select value={f.ent} onChange={(e) => set({ ent: e.target.value })} aria-label="企業・団体" className="input h-8 w-44 py-0 text-[12px]"><option value="">企業・団体：すべて</option>{Object.keys(ec).sort((a, b) => ec[b] - ec[a]).map((e) => <option key={e} value={e}>{e}（{ec[e]}）</option>)}</select>
        <input type="search" value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="キーワード（見出し・要約・企業名）" aria-label="キーワード" className="input h-8 w-52 text-[12px]" />
        <button className="text-xs text-zinc-500 hover:underline" onClick={() => set(AF0)}>条件を解除</button>
      </div>
      <p className="text-[12px] text-zinc-600" aria-live="polite">対象：<b>{rows.length}</b>件（全{M.arts.length}件）・{scope}</p>
      <nav className="flex flex-wrap gap-1" aria-label="分析の種類">
        {([["sum", "概要"], ["pivot", "自由集計"], ["trend", "推移と増減"], ["ent", "企業・プレーヤー"], ["ask", "AI に分析を頼む"]] as const).map(([k, l]) => (
          <button key={k} aria-pressed={sub === k} onClick={() => { setSub(k); setDrill(null); }} className={`rounded-full border px-3 py-1 text-[12px] ${sub === k ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300"}`}>{l}</button>
        ))}
      </nav>
      {sub === "sum" && <Summary rows={rows} M={M} d={d} drill={open} />}
      {sub === "pivot" && <Pivot rows={rows} M={M} DIMS={DIMS} drill={open} name={d.name} />}
      {sub === "trend" && <Trend rows={rows} M={M} DIMS={DIMS} drill={open} />}
      {sub === "ent" && <Entities rows={rows} M={M} drill={open} />}
      {sub === "ask" && <Ask n={n} d={d} M={M} f={f} count={rows.length} />}
      <div id="drill" className="scroll-mt-24" aria-live="polite">
        {drill && (
          <div className="card space-y-2 border-brand-200 p-4">
            <div className="flex items-center gap-2"><h4 className="text-[13px] font-semibold">{drill.t}</h4><span className="text-[11px] text-zinc-500">{dl.length}件{drill.sub ? `・${drill.sub}` : ""}</span>
              <button className="btn-ghost btn-sm ml-auto h-7 w-7 p-0" onClick={() => setDrill(null)} aria-label="閉じる"><X size={14} /></button></div>
            <ol className="list-decimal space-y-1 pl-5 text-[12px]">
              {dl.slice(0, 80).map((a) => (
                <li key={a.key}><span className="tabular-nums text-zinc-400">{a.published} {a.jp ? "国内" : a.country || "海外"}</span> {a.publisher}：<a href={a.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{a.head}</a>
                  {a.issues.map((k) => <span key={k} className="ml-1 rounded-full bg-violet-50 px-1.5 text-[10px] text-violet-700">{k}</span>)}</li>
              ))}
              {dl.length > 80 && <li>ほか{dl.length - 80}件（条件を絞ると全件を見られる）</li>}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}
