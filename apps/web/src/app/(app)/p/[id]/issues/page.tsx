import Link from "next/link";
import { agent, type AgentIssueT, type TeamInfo } from "@/lib/agent";
import { PageHeader } from "@/components/PageHeader";
import { AutoRefresh } from "@/components/autodev/AutoRefresh";
import { Avatar } from "@/components/rail/Avatar";
import { ISSUE_STATUS_TONE } from "@/components/org/bits";
import { NewIssue, STATUSES } from "@/components/issues/IssueForms";

const day = (t: string) => new Date(t).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function IssuesPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ assignee?: string; status?: string; all?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const qs = new URLSearchParams();
  if (sp.assignee) qs.set("assignee", sp.assignee);
  if (sp.status) qs.set("status", sp.status);
  if (!sp.all && !sp.status) qs.set("open_only", "true");
  const [list, team, versions] = await Promise.all([
    agent<AgentIssueT[]>(`/products/${id}/issues?${qs}`), agent<TeamInfo>(`/products/${id}/team`),
    agent<Record<string, string>>("/avatars").catch(() => ({} as Record<string, string>)),
  ]);
  const link = (p: Record<string, string | undefined>) => {
    const q = new URLSearchParams(Object.entries({ assignee: sp.assignee, status: sp.status, all: sp.all, ...p }).filter(([, v]) => v) as [string, string][]);
    return `/p/${id}/issues${q.size ? `?${q}` : ""}`;
  };
  return (
    <>
      <AutoRefresh active ms={10000} />
      <PageHeader
        crumbs={<><Link href={`/p/${id}`} className="hover:text-zinc-700">ダッシュボード</Link><span>/</span><span>Issue</span></>}
        title="Issue"
        sub="エージェントの間で、動く必要があることを記録し、状況を管理します。宛先は PM と各工程の担当まで（PdM は宛先にできません）。担当は10分ごとに自分宛てを確かめ、実行して結果を返します。"
        actions={<NewIssue pid={id} />}
      />
      <div className="space-y-3 px-8 py-6">
        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          <Link href={link({ assignee: undefined })} className={`rounded-full border px-2.5 py-0.5 ${!sp.assignee ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200"}`}>全員</Link>
          {team.agents.map((a) => (
            <Link key={a.key} href={link({ assignee: a.key })} className={`flex items-center gap-1 rounded-full border py-0.5 pl-0.5 pr-2 ${sp.assignee === a.key ? "border-brand-400 bg-brand-50" : "border-zinc-200"}`}>
              <Avatar k={a.key} v={versions[a.key]} size={18} />{a.name}{a.open_issues ? <span className="text-zinc-400">{a.open_issues}</span> : null}
            </Link>
          ))}
        </div>
        <div className="flex gap-1.5 text-[12px]">
          <Link href={link({ status: undefined, all: undefined })} className={`rounded-md px-2 py-0.5 ${!sp.status && !sp.all ? "bg-zinc-900 text-white" : "border border-zinc-200"}`}>終わっていない</Link>
          {Object.entries(STATUSES).map(([k, v]) => <Link key={k} href={link({ status: k, all: undefined })} className={`rounded-md px-2 py-0.5 ${sp.status === k ? "bg-zinc-900 text-white" : "border border-zinc-200"}`}>{v}</Link>)}
          <Link href={link({ status: undefined, all: "1" })} className={`rounded-md px-2 py-0.5 ${sp.all ? "bg-zinc-900 text-white" : "border border-zinc-200"}`}>すべて</Link>
        </div>
        <div className="card overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead className="bg-zinc-50 text-left text-[11px] text-zinc-500">
              <tr>{["#", "トラッカー", "状態", "優先度", "題名", "担当", "起票", "進捗", "期日", "更新"].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-zinc-400">ありません</td></tr>}
              {list.map((i) => (
                <tr key={i.number} className="border-t border-zinc-100 hover:bg-zinc-50">
                  <td className="px-2 py-2 font-mono text-zinc-500"><Link href={`/p/${id}/issues/${i.number}`} className="hover:underline">{i.number}</Link></td>
                  <td className="px-2 py-2">{i.tracker_label}</td>
                  <td className="px-2 py-2"><span className={`rounded px-1.5 py-0.5 text-[11px] ${ISSUE_STATUS_TONE[i.status]}`}>{i.status_label}</span></td>
                  <td className={`px-2 py-2 ${["urgent", "immediate"].includes(i.priority) ? "font-semibold text-rose-600" : ""}`}>{i.priority_label}</td>
                  <td className="max-w-[28rem] px-2 py-2"><Link href={`/p/${id}/issues/${i.number}`} className="font-medium hover:underline">{i.subject}</Link></td>
                  <td className="whitespace-nowrap px-2 py-2"><span className="flex items-center gap-1"><Avatar k={i.assignee} v={versions[i.assignee]} size={18} />{i.assignee_name}</span></td>
                  <td className="whitespace-nowrap px-2 py-2 text-zinc-500">{i.author_name}</td>
                  <td className="px-2 py-2"><div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-100"><div className="h-full bg-emerald-500" style={{ width: `${i.done_ratio}%` }} /></div></td>
                  <td className="whitespace-nowrap px-2 py-2 text-zinc-500">{i.due_date ?? ""}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-zinc-400">{day(i.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
