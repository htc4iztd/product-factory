"use client";
import { useMemo, useState, useTransition } from "react";
import { Download } from "lucide-react";
import type { ResearchData } from "@/lib/agent";
import { type Model, csvDownload } from "./model";
import { Seg } from "./NewsTab";
import { deleteFact } from "@/app/(app)/research/actions";
import { UpdateButton } from "@/components/knowledge/ResearchBits";

// ファクトDB：記事に書かれた数字を1件ずつの行にした一覧。絞り込んだまま CSV にできる
export function FactsTab({ n, d, M, canEdit, art, setArt }: { n: number; d: ResearchData; M: Model; canEdit: boolean; art: string; setArt: (k: string) => void }) {
  const [q, setQ] = useState("");
  const [reg, setReg] = useState<"all" | "jp" | "ov">("all");
  const [kind, setKind] = useState("");
  const [theme, setTheme] = useState("");
  const [del, setDel] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const K = d.options.fact_kinds;
  const ks = useMemo(() => { const c: Record<string, number> = {}; M.facts.forEach((f) => { c[f.kind] = (c[f.kind] ?? 0) + 1; }); return c; }, [M]);
  const ts = useMemo(() => { const c: Record<string, number> = {}; M.facts.forEach((f) => { const t = f.theme || "不明"; c[t] = (c[t] ?? 0) + 1; }); return c; }, [M]);
  const qq = q.trim().toLowerCase();
  const R = M.facts.filter((f) => {
    const a = M.byKey[f.article];
    if (art && f.article !== art) return false;
    if (reg === "jp" && !a?.jp) return false;
    if (reg === "ov" && a?.jp) return false;
    if (kind && f.kind !== kind) return false;
    if (theme && (f.theme || "不明") !== theme) return false;
    if (qq && !`${f.metric} ${f.source} ${f.scope} ${f.value} ${a?.publisher ?? ""} ${a?.head ?? ""}`.toLowerCase().includes(qq)) return false;
    return true;
  });
  const a0 = art ? M.byKey[art] : null;
  return (
    <section className="space-y-3">
      <p className="text-[13px] text-zinc-500">記事に書かれた調査結果・市場規模・利用実績などの数字を、1件ずつの行にした一覧。「原文確認」は、引用が記事の本文にそのまま見つかったもの。数字を使う前にリンク先で確かめてほしい。ファクトは記事の更新のときに増える。</p>
      {canEdit && <div className="flex justify-end"><UpdateButton n={n} scope="articles" label="記事を更新" /></div>}
      <div className="flex flex-wrap items-center gap-2" role="search">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="キーワード（何の数字か・出典・企業名）" aria-label="ファクトのキーワード検索" className="input h-8 w-64 text-[12px]" />
        <Seg value={reg} items={[["all", "すべて"], ["jp", "国内"], ["ov", "海外"]]} onChange={setReg} />
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="種類" className="input h-8 w-40 py-0 text-[12px]">
          <option value="">種類：すべて</option>{Object.keys(ks).sort((a, b) => ks[b] - ks[a]).map((k) => <option key={k} value={k}>{K[k] ?? k}（{ks[k]}）</option>)}
        </select>
        <select value={theme} onChange={(e) => setTheme(e.target.value)} aria-label="テーマ" className="input h-8 w-40 py-0 text-[12px]">
          <option value="">テーマ：すべて</option>{Object.keys(ts).sort((a, b) => ts[b] - ts[a]).map((k) => <option key={k} value={k}>{k}（{ts[k]}）</option>)}
        </select>
        <button className="text-xs text-zinc-500 hover:underline" onClick={() => { setQ(""); setReg("all"); setKind(""); setTheme(""); setArt(""); }}>条件を解除</button>
        <button disabled={!R.length} className="btn-secondary btn-sm ml-auto" onClick={() => csvDownload(`${d.name}_ファクト_${R.length}件.csv`, [
          ["ID", "日付", "地域", "種類", "テーマ", "何の数字か", "値", "対象・範囲", "出典", "原文確認", "企業・団体", "記事", "見出し", "URL"],
          ...R.map((f) => { const a = M.byKey[f.article]; return [f.key, f.date, a?.jp ? "国内" : a?.country || "海外", K[f.kind] ?? f.kind, f.theme, f.metric, f.value, f.scope, f.source, f.verified ? "済" : "未", a?.publisher, f.article, a?.head, a?.url]; }),
        ])}><Download size={13} />CSVで保存</button>
      </div>
      <p className="text-[12px] text-zinc-500" aria-live="polite">
        {R.length}件を表示（全{M.facts.length}件）
        {a0 && <>　記事「{a0.head.slice(0, 40)}」に絞り込み中 <button className="text-brand-700 hover:underline" onClick={() => setArt("")}>解除</button></>}
      </p>
      <div className="card overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead className="bg-zinc-50 text-left text-zinc-500">
            <tr><th className="px-3 py-2">日付</th><th className="px-3 py-2">種類</th><th className="px-3 py-2">テーマ</th><th className="px-3 py-2">何の数字か</th><th className="px-3 py-2">値</th>
              <th className="px-3 py-2">対象・範囲</th><th className="px-3 py-2">出典</th><th className="px-3 py-2">記事</th><th className="px-3 py-2">原文確認</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody>
            {M.facts.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-zinc-400">まだファクトがない。記事の「ファクトを追加」から足せる。</td></tr>}
            {M.facts.length > 0 && R.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-zinc-400">条件に合うファクトはない。</td></tr>}
            {R.map((f) => {
              const a = M.byKey[f.article];
              return (
                <tr key={f.key} id={f.key} className="scroll-mt-24 border-t border-zinc-100 align-top">
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{f.date ?? "—"}</td>
                  <td className="px-3 py-2">{K[f.kind] ?? f.kind}</td>
                  <td className="px-3 py-2">{f.theme}</td>
                  <td className="px-3 py-2" title={f.quote}>{f.metric}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-semibold">{f.value}</td>
                  <td className="px-3 py-2 text-zinc-600">{f.scope}</td>
                  <td className="px-3 py-2 text-zinc-600">{f.source}</td>
                  <td className="max-w-[16rem] px-3 py-2"><a href={a?.url} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline" title={a?.head}>{(a?.head ?? f.article).slice(0, 28)}{(a?.head ?? "").length > 28 ? "…" : ""}</a></td>
                  <td className="px-3 py-2">{f.verified ? "✓" : <span className="text-amber-700">未確認</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {canEdit && (del === f.number
                      ? <><button disabled={pending} className="text-rose-600 hover:underline" onClick={() => start(async () => { await deleteFact(n, f.number); setDel(null); })}>削除する</button> <button className="text-zinc-500 hover:underline" onClick={() => setDel(null)}>やめる</button></>
                      : <button className="text-zinc-400 hover:text-rose-600" onClick={() => setDel(f.number)}>削除</button>)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
