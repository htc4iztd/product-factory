import Link from "next/link";
import { agent, type AgentIssueT, type PmWorkspace } from "@/lib/agent";
import { PageHeader } from "@/components/PageHeader";
import { AutoRefresh } from "@/components/autodev/AutoRefresh";
import { Avatar } from "@/components/rail/Avatar";
import { PmLog, PM_AREA } from "@/components/org/PmChat";
import { ISSUE_STATUS_TONE } from "@/components/org/bits";

const when = (t: string | null) => (t ? new Date(t).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const KIND_TONE: Record<string, string> = { status: "bg-zinc-100 text-zinc-600", risk: "bg-rose-100 text-rose-800", decision: "bg-emerald-100 text-emerald-800", memo: "bg-sky-100 text-sky-800" };

function IssueRows({ pid, list, empty }: { pid: string; list: AgentIssueT[]; empty: string }) {
  if (!list.length) return <p className="px-4 py-3 text-[12px] text-zinc-400">{empty}</p>;
  return (
    <ul className="divide-y divide-zinc-100">
      {list.map((i) => (
        <li key={i.number}><Link href={`/p/${pid}/issues/${i.number}`} className="flex items-center gap-2 px-4 py-2 text-[12.5px] hover:bg-zinc-50">
          <span className="font-mono text-zinc-400">#{i.number}</span>
          <span className={`rounded px-1 text-[10.5px] ${ISSUE_STATUS_TONE[i.status]}`}>{i.status_label}</span>
          <span className="min-w-0 flex-1 truncate">{i.subject}</span>
          <span className="text-[11px] text-zinc-500">{i.author_name}→{i.assignee_name}</span>
        </Link></li>
      ))}
    </ul>
  );
}

// PM の作業場所：PdM との対話・1時間ごとの状況確認で集めたこと（タスク管理の場所）・PM が持つ Issue
export default async function PmPage({ params }: { params: Promise<{ id: string; pm: string }> }) {
  const { id, pm } = await params;
  const [w, versions] = await Promise.all([
    agent<PmWorkspace>(`/products/${id}/pm/${pm}`),
    agent<Record<string, string>>("/avatars").catch(() => ({} as Record<string, string>)),
  ]);
  return (
    <>
      <AutoRefresh active ms={10000} />
      <PageHeader
        crumbs={<><Link href={`/p/${id}`} className="hover:text-zinc-700">ダッシュボード</Link><span>/</span><span>{w.pm.name}</span></>}
        title={<span className="flex items-center gap-3"><Avatar k={pm} v={versions[pm]} size={44} state={w.pm.state ?? "idle"} />{w.pm.name}の作業場所</span>}
        sub={`${PM_AREA[pm]}・状況確認 ${w.pm.cron_label}（最後：${when(w.checked_at)}）・会議でまだ伝えていないこと ${w.pending} 件`}
      />
      <div className="grid gap-6 px-8 py-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="card"><PmLog pid={id} messages={w.messages} versions={versions} title={`${w.pm.name}との対話の記録`} height="max-h-[520px]" /></div>
        <div className="space-y-4">
          <section className="card">
            <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2.5">
              <h2 className="text-[14px] font-semibold">集めたこと（タスク管理の場所）</h2>
              <span className="text-[11px] text-zinc-500">1時間ごとの状況確認で、変わった担当の状況・リスク・決めたことを残し、会議で伝えます</span>
            </div>
            <ol className="max-h-[420px] divide-y divide-zinc-100 overflow-y-auto">
              {w.notes.length === 0 && <li className="px-4 py-3 text-[12px] text-zinc-400">まだありません</li>}
              {w.notes.map((n) => (
                <li key={n.id} className={`flex gap-2 px-4 py-2 text-[12.5px] ${n.meeting_id ? "opacity-60" : ""}`}>
                  <span className={`h-fit shrink-0 rounded px-1 text-[10.5px] ${KIND_TONE[n.kind] ?? KIND_TONE.memo}`}>{n.kind_label}</span>
                  {n.agent && <Avatar k={n.agent} v={versions[n.agent]} size={18} />}
                  <span className="min-w-0 flex-1 whitespace-pre-wrap">{n.text}</span>
                  <span className="shrink-0 text-[10.5px] text-zinc-400">{when(n.created_at)}{n.meeting_id ? "・報告済み" : ""}</span>
                </li>
              ))}
            </ol>
          </section>
          <section className="card"><div className="border-b border-zinc-100 px-4 py-2.5 text-[13px] font-semibold">{w.pm.name}宛ての Issue</div>
            <IssueRows pid={id} list={w.assigned} empty="ありません" /></section>
          <section className="card"><div className="border-b border-zinc-100 px-4 py-2.5 text-[13px] font-semibold">{w.pm.name}が起票した Issue</div>
            <IssueRows pid={id} list={w.authored} empty="ありません" /></section>
          <section className="card p-4 text-[12px]">
            <div className="mb-2 font-semibold">領域の担当</div>
            <div className="flex flex-wrap gap-1.5">
              {w.domain.map((d) => <Link key={d.key} href={`/p/${id}/s/${d.key}`} className="flex items-center gap-1 rounded-full border border-zinc-200 py-0.5 pl-0.5 pr-2 hover:bg-zinc-50"><Avatar k={d.key} v={versions[d.key]} size={20} />{d.name}</Link>)}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
