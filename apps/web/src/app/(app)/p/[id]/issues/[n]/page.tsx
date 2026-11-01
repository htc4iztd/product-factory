import Link from "next/link";
import { Github } from "lucide-react";
import { agent, type AgentIssueT } from "@/lib/agent";
import { PageHeader } from "@/components/PageHeader";
import { AutoRefresh } from "@/components/autodev/AutoRefresh";
import { Avatar } from "@/components/rail/Avatar";
import { ISSUE_STATUS_TONE } from "@/components/org/bits";
import { IssueReply } from "@/components/issues/IssueForms";
import { IssueGithubPanel } from "@/components/issues/GithubSync";

const day = (t: string) => new Date(t).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const NAMES: Record<string, string> = { status: "状態", assignee: "担当", priority: "優先度", done_ratio: "進捗率" };

export default async function IssuePage({ params }: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await params;
  const [i, versions] = await Promise.all([
    agent<AgentIssueT>(`/products/${id}/issues/${n}`),
    agent<Record<string, string>>("/avatars").catch(() => ({} as Record<string, string>)),
  ]);
  const pmOwned = i.assignee.startsWith("pm_");
  const rows: [string, React.ReactNode][] = [
    ["状態", <span key="s" className={`rounded px-1.5 py-0.5 text-[11px] ${ISSUE_STATUS_TONE[i.status]}`}>{i.status_label}</span>],
    ["優先度", i.priority_label], ["担当", <span key="a" className="flex items-center gap-1"><Avatar k={i.assignee} v={versions[i.assignee]} size={18} />{i.assignee_name}</span>],
    ["起票", i.author_name], ["開始日", i.start_date ?? "—"], ["期日", i.due_date ?? "—"],
    ["進捗率", <span key="d" className="flex items-center gap-2"><span className="h-1.5 w-24 overflow-hidden rounded-full bg-zinc-100"><span className="block h-full bg-emerald-500" style={{ width: `${i.done_ratio}%` }} /></span>{i.done_ratio}%</span>],
    ["工程", i.stage_id ? <Link key="st" href={`/p/${id}/s/${i.stage_id}`} className="text-brand-700 hover:underline">{i.stage_id}</Link> : "—"],
  ];
  return (
    <>
      <AutoRefresh active={!["closed", "rejected"].includes(i.status)} ms={6000} />
      <PageHeader
        crumbs={<><Link href={`/p/${id}`} className="hover:text-zinc-700">ダッシュボード</Link><span>/</span><Link href={`/p/${id}/issues`} className="hover:text-zinc-700">Issue</Link><span>/</span><span>#{i.number}</span></>}
        title={`${i.tracker_label} #${i.number}：${i.subject}`}
        sub={`${i.author_name}が ${day(i.created_at)} に起票・${day(i.updated_at)} に更新`}
      />
      <div className="grid gap-6 px-8 py-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <div className="card p-5">
            <div className="text-[11px] font-semibold text-zinc-500">説明</div>
            <p className="mt-1 whitespace-pre-wrap text-[13px] text-zinc-800">{i.description || "（なし）"}</p>
          </div>
          <section className="card divide-y divide-zinc-100" aria-label="履歴">
            <div className="px-5 py-2.5 text-[13px] font-semibold">履歴</div>
            {(i.journals ?? []).length === 0 && <p className="px-5 py-3 text-[12px] text-zinc-400">まだありません。担当は10分ごとに確かめて動きます</p>}
            {(i.journals ?? []).map((j, k) => (
              <div key={j.id} className="flex gap-3 px-5 py-3 text-[13px]">
                {j.author.startsWith("github") ? <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-white"><Github size={14} /></span>
                  : j.author.includes("@") ? <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[9px] font-bold text-white">PdM</span>
                  : <Avatar k={j.author} v={versions[j.author]} size={28} />}
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-zinc-500"><span className="font-semibold text-zinc-800">{j.author_name}</span>・{day(j.created_at)}・#{k + 1}</div>
                  {j.details.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-[12px] text-zinc-600">
                      {j.details.map((x, m) => <li key={m}>・<b>{NAMES[x.prop] ?? x.label}</b>を {String(x.old ?? "—")} から <b>{String(x.new ?? "—")}</b> に変更</li>)}
                    </ul>
                  )}
                  {j.notes && <p className="mt-1 whitespace-pre-wrap text-zinc-800">{j.notes}</p>}
                </div>
              </div>
            ))}
          </section>
          {pmOwned ? <IssueReply pid={id} issue={i} />
            : <p className="text-[12px] text-zinc-500">この Issue は {i.assignee_name}が担当しています。PdM から伝えたいことは、その領域の PM に話してください。</p>}
        </div>
        <aside className="card h-fit space-y-3 p-4">
          <dl className="space-y-2 text-[12.5px]">
            {rows.map(([k, v]) => <div key={k} className="flex items-center justify-between gap-2"><dt className="text-zinc-500">{k}</dt><dd className="text-right">{v}</dd></div>)}
          </dl>
          <IssueGithubPanel pid={id} number={i.number} github={i.github} />
        </aside>
      </div>
    </>
  );
}
