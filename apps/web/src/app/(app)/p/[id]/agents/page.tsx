import Link from "next/link";
import { agent, type AgentFinding, type AgentSchedule, type Overview, type ProductReport, type ResearchLibrary } from "@/lib/agent";
import { PageHeader } from "@/components/PageHeader";
import { AutoRefresh } from "@/components/autodev/AutoRefresh";
import { AgentForm } from "@/components/agents/AgentForm";
import { Inbox, ScheduleList } from "@/components/agents/Inbox";

export default async function AgentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [ov, ag, findings, libs, reports] = await Promise.all([
    agent<Overview>(`/products/${id}`),
    agent<{ schedules: AgentSchedule[]; open: number }>(`/products/${id}/agents`),
    agent<AgentFinding[]>(`/products/${id}/agent-findings`),
    agent<ResearchLibrary[]>("/research").catch(() => [] as ResearchLibrary[]),
    agent<ProductReport[]>(`/products/${id}/reports`),
  ]);
  const libraries = libs.map((l) => ({ number: l.number, name: l.name }));
  const reps = reports.map((r) => ({ number: r.number, title: r.title }));
  // 直近に動かしたものがあるあいだは、提案が届くまで取り直す
  const recent = ag.schedules.some((a) => a.last_run_at && Date.now() - new Date(a.last_run_at).getTime() < 3 * 60 * 1000);
  return (
    <>
      <AutoRefresh active={recent} ms={4000} />
      <PageHeader
        crumbs={<><Link href={`/p/${id}`} className="hover:text-zinc-700">ダッシュボード</Link><span>/</span><span>定期の仕事</span></>}
        title="定期の仕事"
        sub="決めた時刻に、リサーチの更新・報告資料の作り直し・決まった観点での見直しを動かします（工程ごとの日々の仕事は、エージェントの組織の各担当が行います）。見つけたことは受け箱に提案として届き、採用・却下・返信で詰められます。AI が工程の値を直接書き換えることはありません。"
      />
      <div className="grid gap-6 px-8 py-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <section className="space-y-2">
            <h2 className="text-[14px] font-semibold">予定</h2>
            {ag.schedules.length === 0 && <div className="card p-4 text-[13px] text-zinc-400">まだ予定がありません</div>}
            <ScheduleList pid={id} schedules={ag.schedules} stages={ov.stages} libraries={libraries} reports={reps} />
          </section>
          <section className="card p-5">
            <h2 className="mb-3 text-[14px] font-semibold">新しい予定</h2>
            <AgentForm pid={id} stages={ov.stages} libraries={libraries} reports={reps} />
          </section>
        </div>
        <Inbox pid={id} findings={findings} />
      </div>
    </>
  );
}
