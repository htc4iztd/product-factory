"use client";
import { useState } from "react";
import type { ResearchFact } from "@/lib/agent";
import { Bars } from "./Bars";

const DIMS = { kind: "種類", theme: "テーマ", metric: "何の数字か", source: "出典", publisher: "発行元", region: "地域", month: "月" } as const;
type Dim = keyof typeof DIMS;

// ファクトを好きな切り口で数える（自由集計）
export function Pivot({ facts, kinds, regions }: { facts: ResearchFact[]; kinds: Record<string, string>; regions: Record<string, string> }) {
  const [dim, setDim] = useState<Dim>("theme");
  const key = (f: ResearchFact): string => (dim === "month" ? (f.date ?? "").slice(0, 7) : String(f[dim] ?? ""));
  const counts = new Map<string, number>();
  for (const f of facts) counts.set(key(f), (counts.get(key(f)) ?? 0) + 1);
  const rows = [...counts.entries()].sort((a, b) => (dim === "month" ? a[0].localeCompare(b[0]) : b[1] - a[1])).slice(0, 40);
  const labels = dim === "kind" ? kinds : dim === "region" ? regions : undefined;
  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center gap-2">
        <h3 className="text-[13px] font-semibold">自由集計（ファクト {facts.length}件）</h3>
        <select value={dim} onChange={(e) => setDim(e.target.value as Dim)} className="input ml-auto h-8 w-40 py-0 text-[12px]" aria-label="切り口">
          {Object.entries(DIMS).map(([k, l]) => <option key={k} value={k}>{l}ごと</option>)}
        </select>
      </div>
      <Bars rows={rows} labels={labels} />
    </div>
  );
}
