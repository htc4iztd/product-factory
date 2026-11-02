"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ListOrdered, Play, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import type { CyclePlanItem } from "@/lib/agent";
import { saveCyclePlan, startNextCycle, startReview } from "@/app/(app)/p/[id]/cycle-actions";

const PMS: [string, string, string][] = [["pm_biz", "事業PM", "①〜⑤ 事業"], ["pm_design", "設計PM", "⑥〜⑪ 要求・設計"], ["pm_impl", "実装PM", "⑫〜⑬ 構築"]];

// レビューを始める（全工程が100%になる前でも、PdM が始められる）
export function StartReviewButton({ pid, complete }: { pid: string; complete: boolean }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      <button className={complete ? "btn-primary" : "btn-secondary"} disabled={pending}
        onClick={() => {
          if (!complete && !confirm("まだ100%になっていない工程があります。レビューを始めると、エージェントの定期実行を止めます。始めますか？")) return;
          start(async () => { const r = await startReview(pid); if (r.error) setErr(r.error); });
        }}><RotateCcw size={14} />{pending ? "始めています…" : "プロダクトレビューを始める"}</button>
      {err && <span className="text-[12px] text-rose-600">{err}</span>}
    </span>
  );
}

// 次のサイクルの戦略と、PM ごとの追加指示を書いて、次のサイクルを始める
export function NextCycleForm({ pid, next, planned, position }: { pid: string; next: number; planned: boolean; position: CyclePlanItem | null }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [strategy, setStrategy] = useState("");
  const [notes, setNotes] = useState("");
  const [dir, setDir] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <section className="card space-y-3 p-5" aria-label="次のサイクル">
      <div>
        <h2 className="text-[15px] font-semibold">サイクル {next} を始める</h2>
        <p className="mt-0.5 text-[12px] text-zinc-500">
          書いた戦略に沿って、PM が工程ごとの目標と計画を決め、担当に Issue を出します。工程の進み具合は0%に戻ります（成果物は残り、そこからエンハンスします）。
        </p>
      </div>
      {position ? (
        <p className="rounded-lg bg-zinc-50 px-3 py-2 text-[12.5px]"><span className="font-semibold">サイクル {next} の位置付け：{position.label}</span>
          {position.purpose && <span className="text-zinc-600">　{position.purpose}</span>}{position.exit && <span className="text-zinc-500">（終える条件：{position.exit}）</span>}</p>
      ) : (
        <label className="block"><span className="label">サイクル {next} の位置付け（{planned ? "計画にないので、書くと計画に足します・必須" : "任意。書くと計画に足します"}）</span>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="次のサイクルの位置付け" placeholder="例：MMP" /></label>
      )}
      <label className="block"><span className="label">このサイクルのレビューの所見（任意）</span>
        <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="レビューの所見" placeholder="成果物を読んで気づいたこと・足りないこと" /></label>
      <label className="block"><span className="label">次のサイクルの戦略（必須）</span>
        <textarea className="input" rows={4} value={strategy} onChange={(e) => setStrategy(e.target.value)} aria-label="次のサイクルの戦略" placeholder="何を狙い、何を強化するか。優先すること・やらないこと" /></label>
      <div className="grid gap-3 md:grid-cols-3">
        {PMS.map(([k, name, area]) => (
          <label key={k} className="block"><span className="label">{name}への追加指示（{area}・任意）</span>
            <textarea className="input" rows={4} value={dir[k] ?? ""} aria-label={`${name}への追加指示`} onChange={(e) => setDir((d) => ({ ...d, [k]: e.target.value }))} /></label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={pending || !strategy.trim() || (!position && planned && !label.trim())}
          onClick={() => start(async () => {
            const r = await startNextCycle(pid, { strategy, directives: dir, notes, label: position ? "" : label });
            if (r.error) setErr(r.error); else router.push(`/p/${pid}`);
          })}><Play size={14} />{pending ? "始めています…" : `サイクル ${next} を始める`}</button>
        <span className="text-[12px] text-zinc-500">始めると、まず PM が計画を立て、その後で担当が動きます。</span>
        {err && <span className="text-[12px] text-rose-600">{err}</span>}
      </div>
    </section>
  );
}

// サイクルの計画：サイクル数と、それぞれの位置付け（PoC用プロトタイプ・MVP・MMP など）・目的・終える条件
export function CyclePlanEditor({ pid, plan, current, example, planned, readOnly }: {
  pid: string; plan: CyclePlanItem[]; current: number; example: CyclePlanItem[]; planned: boolean; readOnly: boolean;
}) {
  const [rows, setRows] = useState<CyclePlanItem[]>(plan);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(rows) !== JSON.stringify(plan);
  const set = (i: number, k: keyof CyclePlanItem, v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <section className="card space-y-3 p-5" aria-label="サイクルの計画">
      <div className="flex flex-wrap items-center gap-2">
        <ListOrdered size={16} className="text-brand-600" />
        <h2 className="text-[15px] font-semibold">サイクルの計画（{rows.length} サイクル）</h2>
        <span className="text-[12px] text-zinc-500">{planned ? "" : "まだ決めていません（作ったときの範囲を1サイクル目にしています）。"}各サイクルの位置付けは、PM の計画と担当の作り込みの深さに使います。</span>
        {!readOnly && (
          <span className="ml-auto flex gap-1.5">
            <button className="btn-ghost btn-sm" title="PoC用プロトタイプ → MVP → MMP（終わったサイクルはそのまま）"
              onClick={() => setRows(Array.from({ length: Math.max(example.length, current) }, (_, i) => (i < current - 1 ? rows[i] : example[i] ? { ...example[i] } : rows[i])))}>例を入れる</button>
            <button className="btn-secondary btn-sm" disabled={rows.length >= 12} onClick={() => setRows([...rows, { label: "", purpose: "", exit: "" }])}><Plus size={12} />サイクルを足す</button>
            <button className="btn-primary btn-sm" disabled={!dirty || pending || rows.some((r) => !r.label.trim())}
              onClick={() => start(async () => { const r = await saveCyclePlan(pid, rows); setMsg(r.error ?? "保存しました"); })}><Save size={12} />保存</button>
          </span>
        )}
      </div>
      <ol className="space-y-2">
        {rows.map((r, i) => {
          const n = i + 1;
          const tone = n < current ? "border-zinc-200 bg-zinc-50 opacity-80" : n === current ? "border-brand-300 bg-brand-50/40" : "border-zinc-200";
          return (
            <li key={i} className={`space-y-2 rounded-lg border p-3 ${tone}`}>
              <div className="flex items-center gap-3">
                <div className="w-24 shrink-0 text-[12.5px] font-semibold">サイクル {n}<div className="text-[11px] font-normal text-zinc-500">{n < current ? "終わった" : n === current ? "いま" : "これから"}</div></div>
                <input className="input h-9 flex-1 text-[13px] font-medium" value={r.label} disabled={readOnly} aria-label={`サイクル ${n} の位置付け`} placeholder="位置付け（例：PoC用プロトタイプ・MVP・MMP）" onChange={(e) => set(i, "label", e.target.value)} />
                {!readOnly && <button className="btn-ghost btn-sm text-rose-600 disabled:opacity-30" disabled={n <= current} onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`サイクル ${n} を消す`} title={n <= current ? "いまと終わったサイクルは消せません" : ""}><Trash2 size={13} /></button>}
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <textarea className="input text-[12.5px]" rows={2} value={r.purpose} disabled={readOnly} aria-label={`サイクル ${n} の目的`} placeholder="目的（何を確かめる・届けるか）" onChange={(e) => set(i, "purpose", e.target.value)} />
                <textarea className="input text-[12.5px]" rows={2} value={r.exit} disabled={readOnly} aria-label={`サイクル ${n} を終える条件`} placeholder="終える条件" onChange={(e) => set(i, "exit", e.target.value)} />
              </div>
            </li>
          );
        })}
      </ol>
      {msg && <p className="text-[12px] text-zinc-600" role="status">{msg}</p>}
    </section>
  );
}
