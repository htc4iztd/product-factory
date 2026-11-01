"use client";
import { useState } from "react";
import { diffRows, diffSeq, sentences, type Row } from "@/lib/diff";

export type Change = {
  label: string; kind: string; columns: { key: string; label: string }[]; id_key: string;
  config?: { quadrants?: string[] }; before: unknown; after: unknown;
};

const s = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "string" ? v : typeof v === "number" ? String(v) : JSON.stringify(v));
const DEL = "bg-rose-50 text-rose-800 line-through decoration-rose-400/70";
const ADD = "bg-emerald-50 text-emerald-900";

// 変更の要約（「2行変更・1行追加」など）
export function summarize(c: Change): string {
  if (c.kind === "table") {
    const ops = diffRows((c.before as Row[]) ?? [], (c.after as Row[]) ?? [], c.columns.map((x) => x.key), c.id_key);
    const n = (op: string) => ops.filter((x) => x.op === op).length;
    return [n("mod") && `${n("mod")}行変更`, n("add") && `${n("add")}行追加`, n("del") && `${n("del")}行削除`].filter(Boolean).join("・") || "変更なし";
  }
  if (c.kind === "list") {
    const ops = diffSeq(((c.before as string[]) ?? []).map(s), ((c.after as string[]) ?? []).map(s));
    const a = ops.filter((x) => x.op === "add").length, d = ops.filter((x) => x.op === "del").length;
    return [a && `${a}件追加`, d && `${d}件削除`].filter(Boolean).join("・") || "変更なし";
  }
  if (c.kind === "text") {
    if (!s(c.before).trim()) return "新しく書く";
    const ops = diffSeq(sentences(s(c.before)), sentences(s(c.after)));
    const a = ops.filter((x) => x.op === "add").length, d = ops.filter((x) => x.op === "del").length;
    return a || d ? `${a}文追加・${d}文削除` : "変更なし";
  }
  return "変更あり";
}

// 変更前と変更後の差分を、項目の種類に合わせて見せる（表は列見出しつきで、変わったセルだけ色を付ける）
export function ValueDiff({ c }: { c: Change }) {
  if (c.kind === "table") return <TableDiff c={c} />;
  if (c.kind === "list") return <ListDiff before={(c.before as unknown[]) ?? []} after={(c.after as unknown[]) ?? []} />;
  if (c.kind === "text") return <TextDiff before={s(c.before)} after={s(c.after)} />;
  if (c.kind === "matrix") {
    const q = ["q1", "q2", "q3", "q4"] as const;
    const labels = c.config?.quadrants ?? ["左上", "右上", "左下", "右下"];
    const b = (c.before as Record<string, string[]>) ?? {}, a = (c.after as Record<string, string[]>) ?? {};
    return (
      <div className="grid grid-cols-2 gap-1.5">
        {q.map((k, i) => <div key={k} className="rounded border border-zinc-100 p-1.5"><div className="mb-0.5 text-[10.5px] font-semibold text-zinc-500">{labels[i]}</div><ListDiff before={b[k] ?? []} after={a[k] ?? []} /></div>)}
      </div>
    );
  }
  return (
    <div className="grid gap-1.5 md:grid-cols-2">
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-zinc-50 p-2 text-[11px] text-zinc-600">{s(c.before) || "（空）"}</pre>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-emerald-50 p-2 text-[11px]">{s(c.after)}</pre>
    </div>
  );
}

function TextDiff({ before, after }: { before: string; after: string }) {
  const ops = diffSeq(sentences(before), sentences(after));
  return (
    <p className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded border border-zinc-100 bg-white p-2 text-[12.5px] leading-6">
      {ops.map((o, i) => <span key={i} className={o.op === "del" ? DEL : o.op === "add" ? ADD : ""}>{o.v}</span>)}
      {!ops.length && <span className="text-zinc-400">（空）</span>}
    </p>
  );
}

function ListDiff({ before, after }: { before: unknown[]; after: unknown[] }) {
  const ops = diffSeq(before.map(s), after.map(s));
  return (
    <ul className="space-y-0.5 text-[12.5px]">
      {ops.map((o, i) => (
        <li key={i} className={`flex gap-1.5 rounded px-1.5 ${o.op === "del" ? DEL : o.op === "add" ? ADD : "text-zinc-600"}`}>
          <span className="w-3 shrink-0 text-zinc-400">{o.op === "add" ? "＋" : o.op === "del" ? "－" : "・"}</span>{o.v}
        </li>
      ))}
      {!ops.length && <li className="text-zinc-400">（空）</li>}
    </ul>
  );
}

function TableDiff({ c }: { c: Change }) {
  const [all, setAll] = useState(false);
  const cols = c.columns;
  const rows = diffRows((c.before as Row[]) ?? [], (c.after as Row[]) ?? [], cols.map((x) => x.key), c.id_key);
  const same = rows.filter((r) => r.op === "same").length;
  const shown = all ? rows : rows.filter((r) => r.op !== "same");
  return (
    <div className="overflow-x-auto rounded border border-zinc-100">
      <table className="w-full text-[12px]">
        <thead className="bg-zinc-50 text-left text-[11px] text-zinc-500">
          <tr><th className="w-6" />{cols.map((x) => <th key={x.key} className="px-2 py-1 font-medium">{x.label}</th>)}</tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i} className={`border-t border-zinc-100 align-top ${r.op === "add" ? "bg-emerald-50/60" : r.op === "del" ? "bg-rose-50/60" : ""}`}>
              <td className="px-1 py-1 text-center text-[11px] font-semibold text-zinc-400">{{ add: "＋", del: "－", mod: "～", same: "" }[r.op]}</td>
              {cols.map((x) => {
                const b = s(r.before?.[x.key]), a = s(r.after?.[x.key]);
                if (r.op === "del") return <td key={x.key} className={`px-2 py-1 ${DEL}`}>{b}</td>;
                if (r.op === "mod" && r.changed.includes(x.key)) {
                  return (
                    <td key={x.key} className="px-2 py-1">
                      {b && <div className={`mb-0.5 rounded px-1 text-[11px] ${DEL}`}>{b}</div>}
                      <div className={`rounded px-1 ${ADD}`}>{a || "（空）"}</div>
                    </td>
                  );
                }
                return <td key={x.key} className={`px-2 py-1 ${r.op === "same" ? "text-zinc-500" : ""}`}>{a}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {same > 0 && (
        <button className="w-full border-t border-zinc-100 py-1 text-[11px] text-zinc-500 hover:bg-zinc-50" onClick={() => setAll((x) => !x)}>
          {all ? "変更のない行をたたむ" : `変更のない行 ${same} 件を見る`}
        </button>
      )}
    </div>
  );
}
