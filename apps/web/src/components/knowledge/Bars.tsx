// 横棒の件数グラフ（サーバーでもクライアントでも使う）
export function Bars({ rows, labels, max }: { rows: [string, number][]; labels?: Record<string, string>; max?: number }) {
  const top = max ?? Math.max(1, ...rows.map(([, v]) => v));
  if (rows.length === 0) return <p className="text-[12px] text-zinc-400">データがありません</p>;
  return (
    <ul className="space-y-1">
      {rows.map(([k, v]) => { const label = labels?.[k] ?? k; return (
        <li key={k} className="grid grid-cols-[9rem_1fr_2.5rem] items-center gap-2 text-[12px]">
          <span className="truncate text-zinc-600" title={label}>{label || "（なし）"}</span>
          <span className="h-3 rounded-sm bg-brand-500/80" style={{ width: `${(v / top) * 100}%`, minWidth: 2 }} />
          <span className="text-right tabular-nums text-zinc-700">{v}</span>
        </li>
      ); })}
    </ul>
  );
}
