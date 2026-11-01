"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Send, ShieldAlert, Wrench } from "lucide-react";
import type { PlatformFindingT, PlatformMessageT } from "@/lib/agent";
import { actPlatform, setPlatformFinding, talkPlatform } from "@/app/(app)/p/[id]/org-actions";
import { Avatar } from "@/components/rail/Avatar";

const when = (t: string | null) => (t ? new Date(t).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const SEV: Record<string, string> = { high: "bg-rose-100 text-rose-800", medium: "bg-amber-100 text-amber-800", low: "bg-zinc-100 text-zinc-600" };
const STATUS: Record<string, string> = { open: "未対応", ack: "対応中", resolved: "解決" };

// 見つかった稼働の問題。対処は PdM が「承認して実行」したものだけ動く
export function FindingList({ pid, findings }: { pid: string; findings: PlatformFindingT[] }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Record<number, string>>({});
  const live = findings.filter((f) => f.status !== "resolved");
  const done = findings.filter((f) => f.status === "resolved");
  const run = (id: number, fn: () => Promise<{ error?: string; done?: string }>) =>
    start(async () => { const r = await fn(); setMsg((m) => ({ ...m, [id]: r.error ?? r.done ?? "" })); });
  return (
    <section className="card" aria-label="稼働の問題">
      <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2.5">
        <ShieldAlert size={15} className="text-rose-600" />
        <h2 className="text-[14px] font-semibold">稼働の問題</h2>
        <span className="text-[11px] text-zinc-500">記録から決まった規則で見つけます（5分ごと・この画面を開いたとき）。見つからなくなったら自動で解決にします</span>
      </div>
      {live.length === 0 && <p className="px-4 py-4 text-[12.5px] text-emerald-700">未対応の問題はありません。</p>}
      <ul className="divide-y divide-zinc-100">
        {live.map((f) => (
          <li key={f.id} className="space-y-1.5 px-4 py-3" data-finding={f.id}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-1.5 text-[10.5px] font-medium ${SEV[f.severity]}`}>{f.severity_label}</span>
              <span className="rounded bg-zinc-100 px-1.5 text-[10.5px] text-zinc-600">{STATUS[f.status]}</span>
              <span className="min-w-0 flex-1 text-[13px] font-medium">{f.title}</span>
              {f.product_name && <span className="text-[11px] text-zinc-500">{f.product_name}</span>}
            </div>
            {f.detail && <p className="whitespace-pre-wrap text-[12px] text-zinc-600">{f.detail}</p>}
            <p className="text-[12px] text-zinc-800"><span className="font-medium text-brand-700">対処の案：</span>{f.suggestion}</p>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
              <span>最初 {when(f.first_at)}・最後 {when(f.last_at)}</span>
              <span className="ml-auto" />
              {f.action && (
                <button className="btn-primary btn-sm" disabled={pending} onClick={() => run(f.id, () => actPlatform(pid, f.id))}>
                  <Wrench size={12} />承認して実行：{f.action.label}
                </button>
              )}
              {f.status === "open" && <button className="btn-secondary btn-sm" disabled={pending} onClick={() => run(f.id, () => setPlatformFinding(pid, f.id, "ack"))}>確かめた</button>}
              <button className="btn-secondary btn-sm" disabled={pending} onClick={() => run(f.id, () => setPlatformFinding(pid, f.id, "resolved"))}><Check size={12} />解決にする</button>
            </div>
            {msg[f.id] && <p className="text-[11.5px] text-zinc-600">{msg[f.id]}</p>}
          </li>
        ))}
      </ul>
      {done.length > 0 && (
        <details className="border-t border-zinc-100 px-4 py-2 text-[12px]">
          <summary className="cursor-pointer text-zinc-500">解決した問題（{done.length}）</summary>
          <ul className="mt-1 space-y-1">
            {done.map((f) => <li key={f.id} className="text-zinc-500">{when(f.resolved_at)}　{f.title}{f.product_name ? `（${f.product_name}）` : ""}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}

// PdM とプラットフォームの対話。答えには運用の対処（ops）と処理系の修正案（code）が付く
export function PlatformChat({ pid, messages, version }: { pid: string; messages: PlatformMessageT[]; version?: string }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [messages.length]);
  const send = (t: string = text) => start(async () => {
    const r = await talkPlatform(pid, t);
    if (r.error) setError(r.error); else { setText(""); setError(null); }
  });
  return (
    <section className="card flex min-h-0 flex-col" aria-label="プラットフォームとの対話">
      <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2.5">
        <Avatar k="platform" v={version} size={24} />
        <h2 className="text-[14px] font-semibold">プラットフォームと話す</h2>
        <span className="ml-auto text-[11px] text-zinc-400">対処は提案まで。実行は PdM の承認で、コードの修正は提案だけ</span>
      </div>
      <ol className="max-h-[520px] flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {messages.length === 0 && <li className="text-[12px] text-zinc-400">まだ話していません。「いま全体はちゃんと動いてる？」のように聞けます。重い問題が出たら、こちらから知らせます。</li>}
        {messages.map((m) => {
          const me = m.role === "pdm";
          return (
            <li key={m.id} className={`flex items-end gap-2 ${me ? "justify-end" : ""}`}>
              {!me && <Avatar k="platform" v={version} size={26} />}
              <div className={`max-w-[85%] rounded-xl px-3 py-2 text-[12.5px] ${me ? "bg-zinc-900 text-white" : m.text.startsWith("【要対応】") ? "bg-rose-50 text-rose-900 ring-1 ring-rose-200" : "bg-zinc-100 text-zinc-800"}`}>
                <div className={`mb-0.5 text-[10px] ${me ? "text-zinc-400" : "text-zinc-500"}`}>{me ? "PdM" : "プラットフォーム"}・{when(m.created_at)}</div>
                <div className="whitespace-pre-wrap">{m.text}</div>
                {m.proposals.length > 0 && (
                  <ul className="mt-1.5 space-y-1">
                    {m.proposals.map((p, i) => (
                      <li key={i} className="rounded bg-white px-2 py-1 text-[11.5px] text-zinc-700">
                        <span className={`mr-1 rounded px-1 text-[10px] font-medium ${p.kind === "code" ? "bg-violet-100 text-violet-800" : "bg-sky-100 text-sky-800"}`}>{p.kind === "code" ? "処理系の修正案" : "運用の対処"}</span>
                        <span className="font-medium">{p.title}</span>
                        <div className="whitespace-pre-wrap text-zinc-600">{p.detail}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
        {pending && <li className="text-[12px] text-zinc-400">プラットフォームが調べています…</li>}
        <div ref={end} />
      </ol>
      <div className="space-y-1.5 border-t border-zinc-100 p-3">
        <div className="flex flex-wrap gap-1.5">
          {["いま全体はちゃんと動いてる？", "失敗しているジョブの原因と直し方は？", "処理系で直すべきところは？"].map((q) => (
            <button key={q} disabled={pending} onClick={() => send(q)} className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] text-zinc-600 hover:border-brand-200 hover:text-brand-700">{q}</button>
          ))}
        </div>
        <textarea className="input text-[13px]" rows={2} value={text} aria-label="プラットフォームへの発言" placeholder="例：昨日から設計PMの状況確認が来ていない気がする"
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) send(); }} />
        {error && <p className="text-[12px] text-rose-600">{error}</p>}
        <button className="btn-primary btn-sm" disabled={pending || !text.trim()} onClick={() => send()}><Send size={12} />{pending ? "調べています…" : "話す"}</button>
      </div>
    </section>
  );
}
