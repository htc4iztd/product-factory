import Link from "next/link";
import type { PmMessageT } from "@/lib/agent";
import { PM_NAME } from "@/lib/pm";
import { Avatar } from "@/components/rail/Avatar";

const time = (t: string) => new Date(t).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
export const PM_AREA: Record<string, string> = { pm_biz: "①〜⑤ 事業", pm_design: "⑥〜⑪ 要求・設計", pm_impl: "⑫〜⑬ 構築" };

// PdM と PM の対話の記録（読むだけ）。話しかけるのは右のチャット（ファクトリー全体で1つ）
export function PmLog({ pid, messages, versions = {}, title = "PM との対話の記録", empty = "まだありません。右のチャットで話しかけると、ここにも残ります。", height = "max-h-[480px]" }: {
  pid: string; messages: PmMessageT[]; versions?: Record<string, string>; title?: string; empty?: string; height?: string;
}) {
  return (
    <section className="flex min-h-0 flex-col" aria-label={title}>
      <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2.5">
        <h2 className="text-[14px] font-semibold">{title}</h2>
        <span className="ml-auto text-[11px] text-zinc-400">話しかけるのは右のチャットから</span>
      </div>
      <ol className={`${height} space-y-2 overflow-y-auto px-4 py-3`}>
        {messages.length === 0 && <li className="text-[12px] text-zinc-400">{empty}</li>}
        {messages.map((m) => {
          const me = m.role === "pdm";
          return (
            <li key={m.id} className={`flex items-end gap-2 ${me ? "justify-end" : ""}`}>
              {!me && <Avatar k={m.pm} v={versions[m.pm]} size={24} />}
              <div className={`max-w-[85%] rounded-xl px-3 py-2 text-[12.5px] ${me ? "bg-zinc-800 text-white" : "bg-zinc-100 text-zinc-800"}`}>
                <div className={`mb-0.5 text-[10px] ${me ? "text-zinc-400" : "text-zinc-500"}`}>{me ? "PdM" : PM_NAME[m.pm as keyof typeof PM_NAME] ?? m.pm_name}・{time(m.created_at)}{m.stage_id ? `・${m.stage_id}` : ""}{m.meeting_id ? "・会議" : ""}</div>
                <div className="whitespace-pre-wrap">{m.text}</div>
                {m.issues.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {m.issues.map((n) => <Link key={n} href={`/p/${pid}/issues/${n}`} className="rounded bg-white px-1.5 text-[11px] font-medium text-brand-700 hover:underline">#{n}</Link>)}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
