import { agent, type AgentIssueT } from "@/lib/agent";
import { Md } from "@/components/md/Md";
import { SubHeader } from "@/components/mobile/MobileBits";

const when = (t: string) => new Date(t).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

// スマホの Issue：中身と経過を読む。返事・指示は下の入力欄で（話題はこの Issue）
export default async function MobileIssue({ params }: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await params;
  const i = await agent<AgentIssueT>(`/products/${id}/issues/${n}`);
  return (
    <div>
      <SubHeader back={`/p/${id}`} title={`#${i.number} ${i.subject}`} sub={`${i.status_label}・担当 ${i.assignee_name}`} />
      <div className="space-y-4 px-4 py-4 text-[14px]">
        <div className="text-[12px] text-zinc-500">{i.tracker_label}・優先度 {i.priority_label}・{i.author_name}が {when(i.created_at)} に作成</div>
        {i.description.trim() && <div className="leading-relaxed"><Md>{i.description}</Md></div>}
        {(i.journals ?? []).filter((j) => j.notes.trim() || j.details.length).length > 0 && (
          <ol className="space-y-2 border-t border-zinc-100 pt-3" aria-label="経過">
            {(i.journals ?? []).filter((j) => j.notes.trim() || j.details.length).map((j) => (
              <li key={j.id} className="rounded-lg bg-zinc-50 px-3 py-2 text-[13px]">
                <div className="text-[11px] text-zinc-500">{j.author_name}・{when(j.created_at)}</div>
                {j.details.map((d, k) => <div key={k} className="text-[12px] text-zinc-600">{d.label}：{String(d.old ?? "—")} → {String(d.new ?? "—")}</div>)}
                {j.notes.trim() && <div className="whitespace-pre-wrap">{j.notes}</div>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
