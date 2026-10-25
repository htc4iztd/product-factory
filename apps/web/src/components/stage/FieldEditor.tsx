"use client";
import { useState, useTransition } from "react";
import { Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import type { FieldSpec, FieldValue, Row } from "@/lib/agent";
import { setField } from "@/app/(app)/p/[id]/s/[stage]/actions";

type Props = {
  pid: string; sid: string; field: FieldSpec; value: FieldValue; readOnly?: boolean;
  hasProposal?: boolean; compact?: boolean; hideLabel?: boolean;
};

export function FieldView({ field, value, compact }: { field: FieldSpec; value: FieldValue; compact?: boolean }) {
  const empty = <span className="text-zinc-400">{field.hint || "未記入"}</span>;
  if (field.kind === "text") {
    const v = String(value ?? "").trim();
    return <div className="whitespace-pre-wrap break-words">{v || empty}</div>;
  }
  if (field.kind === "list") {
    const items = (value as string[] | undefined) ?? [];
    if (!items.length) return empty;
    return (
      <ul className="space-y-1">
        {items.map((v, i) => (
          <li key={i} className="flex gap-2"><span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-zinc-400" /><span className="break-words">{v}</span></li>
        ))}
      </ul>
    );
  }
  const rows = (value as Row[] | undefined) ?? [];
  const filled = rows.some((r) => field.columns.slice(field.rows.length ? 1 : 0).some((c) => String(r[c.key] ?? "").trim()));
  if (!filled) return empty;
  return (
    <div className="overflow-x-auto">
      <table className={`w-full border-collapse ${compact ? "text-[11px]" : "text-xs"}`}>
        <thead>
          <tr>{field.columns.map((c) => <th key={c.key} className="border-b border-zinc-200 px-2 py-1.5 text-left font-medium text-zinc-500">{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-zinc-100 last:border-0">
              {field.columns.map((c, j) => (
                <td key={c.key} className={`px-2 py-1.5 align-top ${c.kind === "number" ? "text-right tabular-nums" : ""} ${j === 0 && field.rows.length ? "font-medium" : ""}`}>
                  {String(r[c.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TableInput({ field, rows, onChange }: { field: FieldSpec; rows: Row[]; onChange: (r: Row[]) => void }) {
  const fixed = field.rows.length > 0;
  const set = (i: number, k: string, v: string) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-zinc-200">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-zinc-50">
            <tr>
              {field.columns.map((c) => <th key={c.key} className="px-2 py-1.5 text-left font-medium text-zinc-500">{c.label}</th>)}
              {!fixed && <th className="w-8" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-zinc-100">
                {field.columns.map((c, j) => (
                  <td key={c.key} className="p-1">
                    {fixed && j === 0 ? (
                      <span className="px-1.5 font-medium">{String(r[c.key] ?? "")}</span>
                    ) : (
                      <input
                        value={String(r[c.key] ?? "")}
                        onChange={(e) => set(i, c.key, e.target.value)}
                        inputMode={c.kind === "number" ? "decimal" : undefined}
                        className={`w-full min-w-[5rem] rounded-md border border-transparent bg-transparent px-1.5 py-1 outline-none hover:border-zinc-200 focus:border-brand-500 focus:bg-white ${c.kind === "number" ? "text-right tabular-nums" : ""}`}
                      />
                    )}
                  </td>
                ))}
                {!fixed && (
                  <td className="p-1 text-center">
                    <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="btn-ghost btn-sm px-1" title="行を削除"><Trash2 size={13} /></button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!fixed && (
        <button type="button" onClick={() => onChange([...rows, Object.fromEntries(field.columns.map((c) => [c.key, ""]))])} className="btn-ghost btn-sm">
          <Plus size={13} />行を追加
        </button>
      )}
    </div>
  );
}

export function FieldEditor({ pid, sid, field, value, readOnly, hasProposal, compact, hideLabel }: Props) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function open() {
    if (readOnly) return;
    setError(null);
    if (field.kind === "table") setRows(((value as Row[]) ?? []).map((r) => ({ ...r })));
    else setText(field.kind === "list" ? ((value as string[]) ?? []).join("\n") : String(value ?? ""));
    setEditing(true);
  }
  function save() {
    const v: FieldValue = field.kind === "table" ? rows : field.kind === "list" ? text.split("\n").map((s) => s.trim()).filter(Boolean) : text;
    start(async () => {
      const r = await setField(pid, sid, field.key, v);
      if (r.error) setError(r.error);
      else setEditing(false);
    });
  }

  return (
    <div className={`group/field relative ${compact ? "text-[12px]" : "text-[13px]"}`}>
      {!hideLabel && (
        <div className={`mb-1.5 flex items-center gap-1.5 ${compact ? "pr-6" : ""}`}>
          <span className={`font-medium text-zinc-800 ${compact ? "text-[12px] leading-tight" : ""}`}>{field.label}</span>
          {field.required && (compact
            ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" title="必須" />
            : <span className="text-[10px] text-rose-400">必須</span>)}
          {hasProposal && (compact
            ? <span title="AIの案があります"><Sparkles size={11} className="shrink-0 text-brand-600" /></span>
            : <span className="flex items-center gap-0.5 rounded bg-brand-50 px-1 text-[10px] font-medium text-brand-700"><Sparkles size={10} />AI案</span>)}
          {!readOnly && !editing && (
            <button onClick={open} className={`btn-ghost btn-sm h-6 px-1.5 opacity-40 transition group-hover/field:opacity-100 focus:opacity-100 ${compact ? "absolute -right-1 -top-1" : "ml-auto"}`} aria-label={`${field.label}を編集`}>
              <Pencil size={12} />
            </button>
          )}
        </div>
      )}
      {editing ? (
        <div className="space-y-2">
          {field.kind === "table" ? (
            <TableInput field={field} rows={rows} onChange={setRows} />
          ) : (
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
                if (e.key === "Escape") setEditing(false);
              }}
              rows={Math.max(3, text.split("\n").length + 1)}
              placeholder={field.kind === "list" ? "1行に1つずつ" : field.hint}
              className="input text-[13px]"
            />
          )}
          {error && <p className="text-xs text-rose-600">{error}</p>}
          <div className="flex items-center gap-2">
            <button onClick={save} disabled={pending} className="btn-primary btn-sm">{pending ? "保存中…" : "保存"}</button>
            <button onClick={() => setEditing(false)} className="btn-ghost btn-sm">キャンセル</button>
            {field.kind !== "table" && <span className="ml-auto text-[10px] text-zinc-400"><span className="kbd">⌘</span>+<span className="kbd">Enter</span> で保存</span>}
          </div>
        </div>
      ) : (
        <div onDoubleClick={open} className={`${readOnly ? "" : "cursor-text"} leading-relaxed text-zinc-700`}>
          <FieldView field={field} value={value} compact={compact} />
        </div>
      )}
    </div>
  );
}
