"use client";
import { ClipboardCheck } from "lucide-react";
import { Feed } from "@/components/assistant/AssistantShell";
import { Avatar } from "@/components/rail/Avatar";
import type { ConsultNote } from "@/app/(app)/p/[id]/s/[stage]/consult/actions";
import { useMobile } from "./MobileShell";

// スマホの相談：合意メモ（たためる）と、担当との対話。入力は下の入力欄（話題はこの担当との相談）
export function MobileConsult({ sid, name, notes }: { sid: string; name: string; notes: ConsultNote[] }) {
  const { msgs, live, replace } = useMobile();
  const thread = msgs.filter((m) => m.context.kind === "consult" && m.context.stage_id === sid);
  return (
    <div>
      <details className="mx-3 mt-2 rounded-xl bg-emerald-50/60 px-3 py-2 text-[13px]">
        <summary className="flex cursor-pointer items-center gap-1.5 font-semibold text-emerald-900"><ClipboardCheck size={14} />合意メモ（{notes.length}）</summary>
        <ol className="mt-1.5 space-y-1 text-zinc-800">
          {notes.length === 0 && <li className="text-[12px] text-zinc-500">まだありません。決めたことは、担当が合意メモに残す承認依頼にします。</li>}
          {notes.map((n, i) => <li key={n.id}>{i + 1}. {n.text}</li>)}
        </ol>
      </details>
      {thread.length === 0 && !live ? (
        <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <Avatar k={sid} size={56} />
          <div className="text-[15px] font-semibold">{name}に相談する</div>
          <p className="text-[13px] text-zinc-500">この分野の専門家として、問いを立てて導き、選択肢と根拠を出します。下の入力欄に「相談を始めたい」と書いて送ってください。</p>
        </div>
      ) : <Feed msgs={thread} live={live} onChanged={replace} />}
    </div>
  );
}
