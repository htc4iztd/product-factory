// 変更前と変更後の差分（承認依頼の見せ方）。列（配列）の最長共通部分で、残った・消えた・増えたを分ける
export type Op<T> = { op: "same" | "del" | "add"; v: T };

export function diffSeq<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean = (x, y) => x === y): Op<T>[] {
  const n = a.length, m = b.length;
  if (n * m > 400_000) return [...a.map((v) => ({ op: "del" as const, v })), ...b.map((v) => ({ op: "add" as const, v }))];
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = eq(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: Op<T>[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (eq(a[i], b[j])) { out.push({ op: "same", v: b[j] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ op: "del", v: a[i++] });
    else out.push({ op: "add", v: b[j++] });
  }
  while (i < n) out.push({ op: "del", v: a[i++] });
  while (j < m) out.push({ op: "add", v: b[j++] });
  return out;
}

// 文章を文に分ける（。！？・改行で区切る。区切りは文に含める）
export function sentences(t: string): string[] {
  return (String(t ?? "").match(/[^。！？\n]+[。！？]?|\n/g) ?? []).map((s) => s).filter((s) => s.trim());
}

export type Row = Record<string, unknown>;
export type RowChange = { op: "same" | "add" | "del" | "mod"; before?: Row; after?: Row; changed: string[] };

// 表の行を対応づける：ID 列（行見出し）があればそれで、なければ中身の一致で
export function diffRows(a: Row[], b: Row[], cols: string[], idKey: string): RowChange[] {
  const str = (r: Row, k: string) => String(r?.[k] ?? "").trim();
  const changed = (x: Row, y: Row) => cols.filter((k) => str(x, k) !== str(y, k));
  if (idKey) {
    const byA = new Map(a.map((r) => [str(r, idKey), r]));
    const seen = new Set<string>();
    const out: RowChange[] = [];
    for (const r of b) {
      const id = str(r, idKey);
      const old = id ? byA.get(id) : undefined;
      if (old) { seen.add(id); const c = changed(old, r); out.push({ op: c.length ? "mod" : "same", before: old, after: r, changed: c }); }
      else out.push({ op: "add", after: r, changed: cols });
    }
    for (const r of a) if (!seen.has(str(r, idKey))) out.push({ op: "del", before: r, changed: cols });
    return out;
  }
  // ID がない表：同じ行は残し、消えた行と増えた行が隣り合えば「変わった行」とみなす
  const ops = diffSeq(a, b, (x, y) => changed(x, y).length === 0);
  const out: RowChange[] = [];
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i], nx = ops[i + 1];
    // 隣り合う「消えた行」と「増えた行」は、半分以上の列が同じときだけ「変わった行」とみなす（違えば別の行として出す）
    if (o.op === "del" && nx?.op === "add" && changed(o.v, nx.v).length <= cols.length / 2) { const c = changed(o.v, nx.v); out.push({ op: c.length ? "mod" : "same", before: o.v, after: nx.v, changed: c }); i++; }
    else if (o.op === "same") out.push({ op: "same", before: o.v, after: o.v, changed: [] });
    else out.push({ op: o.op, before: o.op === "del" ? o.v : undefined, after: o.op === "add" ? o.v : undefined, changed: cols });
  }
  return out;
}
