"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Send } from "lucide-react";
import { type PmKey, type PmMessageT } from "@/lib/agent";
import { PM_KEYS, PM_NAME } from "@/lib/pm";
import { talkPm } from "@/app/(app)/p/[id]/org-actions";
import { Avatar } from "@/components/rail/Avatar";
import { AttachButton, AttachChips, SentAttachments, useAttachments } from "@/components/chat/Attachments";
import { ResearchImport } from "@/components/stage/ChatPanel";
import { sendResearchToPm } from "@/app/(app)/research/actions";
import { Library } from "lucide-react";

const time = (t: string) => new Date(t).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
export const PM_AREA: Record<string, string> = { pm_biz: "①〜⑤ 事業", pm_design: "⑥〜⑪ 要求・設計", pm_impl: "⑫〜⑭ 構築・リリース" };

// PdM と PM の対話。PdM が話せるのは PM だけ。PM はすぐ答え、担当には Issue で伝える（起票した Issue は番号で出る）
export function PmChat({ pid, messages, versions = {}, pm: fixed, stageId, meetingId, title = true, height = "max-h-[380px]" }: {
  pid: string; messages: PmMessageT[]; versions?: Record<string, string>; pm?: PmKey; stageId?: string; meetingId?: number;
  title?: boolean; height?: string;
}) {
  const [pm, setPm] = useState<PmKey>(fixed ?? "pm_biz");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const files = useAttachments(pid, pm);
  const end = useRef<HTMLDivElement>(null);
  const shown = messages.filter((m) => m.pm === pm);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [shown.length, pm]);
  useEffect(() => { if (fixed) setPm(fixed); }, [fixed]);
  const [importing, setImporting] = useState(false);
  const send = (t: string = text) => start(async () => {
    const r = await talkPm(pid, pm, t, { stage_id: stageId, meeting_id: meetingId, attachments: files.items.map((a) => a.id) });
    if (r.error) setError(r.error); else { setText(""); setError(null); files.clear(); }
  });
  return (
    <section className="flex min-h-0 flex-col" aria-label="PM との対話">
      {title && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-100 px-4 py-2.5">
          <h2 className="mr-1 text-[14px] font-semibold">PM と話す</h2>
          {!fixed && PM_KEYS.map((k) => (
            <button key={k} onClick={() => setPm(k)} aria-pressed={pm === k}
              className={`flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-[12px] ${pm === k ? "border-brand-400 bg-brand-50 font-medium text-brand-800" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"}`}>
              <Avatar k={k} v={versions[k]} size={22} />{PM_NAME[k]}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-zinc-400">{PM_AREA[pm]}・担当には PM が Issue で伝えます</span>
        </div>
      )}
      <ol className={`${height} flex-1 space-y-2 overflow-y-auto px-4 py-3`}>
        {shown.length === 0 && <li className="text-[12px] text-zinc-400">{PM_NAME[pm]}とはまだ話していません。意図や決めたことを伝えると、PM が担当への Issue に落とします。</li>}
        {shown.map((m) => {
          const me = m.role === "pdm";
          return (
            <li key={m.id} className={`flex items-end gap-2 ${me ? "justify-end" : ""}`}>
              {!me && <Avatar k={m.pm} v={versions[m.pm]} size={26} />}
              <div className={`max-w-[85%] rounded-xl px-3 py-2 text-[12.5px] ${me ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-800"}`}>
                <div className={`mb-0.5 text-[10px] ${me ? "text-zinc-400" : "text-zinc-500"}`}>
                  {me ? "PdM" : m.pm_name}・{time(m.created_at)}{m.stage_id ? `・${m.stage_id}` : ""}{m.meeting_id ? "・会議" : ""}
                </div>
                <div className="whitespace-pre-wrap">{m.text}</div>
                <SentAttachments items={m.attachments} dark={me} />
                {m.issues.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {m.issues.map((n) => <Link key={n} href={`/p/${pid}/issues/${n}`} className="rounded bg-white px-1.5 text-[11px] font-medium text-brand-700 hover:underline">#{n}</Link>)}
                  </div>
                )}
              </div>
            </li>
          );
        })}
        {pending && <li className="text-[12px] text-zinc-400">{PM_NAME[pm]}が考えています…</li>}
        <div ref={end} />
      </ol>
      <div className="space-y-1.5 border-t border-zinc-100 p-3">
        {stageId && importing && (
          <ResearchImport busy={pending} onClose={() => setImporting(false)}
            onSend={(n, issue) => start(async () => { setImporting(false); const r = await sendResearchToPm(pid, pm, stageId, n, issue); setError(r.error ?? null); })} />
        )}
        {stageId && (
          <div className="flex flex-wrap gap-1.5">
            {!importing && (
              <button disabled={pending} onClick={() => setImporting(true)} className="flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-[11px] text-brand-700">
                <Library size={11} />リサーチから取り込む
              </button>
            )}
            {["この工程の下書きを作って", "矛盾や抜けを確かめて"].map((q) => (
              <button key={q} disabled={pending} onClick={() => send(q)} className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] text-zinc-600 hover:border-brand-200 hover:text-brand-700">{q}</button>
            ))}
          </div>
        )}
        <AttachChips a={files} />
        <textarea className="input text-[13px]" rows={2} value={text} aria-label={`${PM_NAME[pm]}への発言`} onPaste={files.onPaste}
          placeholder={stageId ? "例：この工程の下書きを作って。対象は共働き世帯に絞る" : "例：MVP は締め処理だけに絞る。設計は来週までに"}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) send(); }} />
        {error && <p className="text-[12px] text-rose-600">{error}</p>}
        <div className="flex items-center gap-2">
          <AttachButton a={files} disabled={pending} />
          <button className="btn-primary btn-sm" disabled={pending || !text.trim() || files.busy} onClick={() => send()}><Send size={12} />{pending ? "考えています…" : "話す"}</button>
          <Link href={`/p/${pid}/pm/${pm}`} className="ml-auto text-[11px] text-zinc-500 hover:underline">{PM_NAME[pm]}の作業場所</Link>
        </div>
      </div>
    </section>
  );
}
