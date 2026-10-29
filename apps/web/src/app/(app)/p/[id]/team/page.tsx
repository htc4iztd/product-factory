import Link from "next/link";
import { agent, type TeamMember, type TeamTask } from "@/lib/agent";
import { PageHeader } from "@/components/PageHeader";
import { AutoRefresh } from "@/components/autodev/AutoRefresh";
import { OrgSettings, TaskBoard } from "@/components/org/OrgSettings";
import { RunTeamButton } from "@/components/org/DirectorChat";

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [team, tasks, versions] = await Promise.all([
    agent<{ agents: TeamMember[] }>(`/products/${id}/team`),
    agent<TeamTask[]>(`/products/${id}/team/tasks`),
    agent<Record<string, string>>("/avatars").catch(() => ({} as Record<string, string>)),
  ]);
  return (
    <>
      <AutoRefresh active ms={10000} />
      <PageHeader
        crumbs={<><Link href={`/p/${id}`} className="hover:text-zinc-700">ダッシュボード</Link><span>/</span><span>エージェントの組織</span></>}
        title="エージェントの組織"
        sub="司令塔・PM・各工程の担当の使命と動く時刻、それぞれが洗い出したタスク。"
        actions={<RunTeamButton pid={id} running={false} />}
      />
      <div className="space-y-6 px-8 py-6">
        <OrgSettings pid={id} agents={team.agents} versions={versions} />
        <TaskBoard pid={id} tasks={tasks} agents={team.agents} />
      </div>
    </>
  );
}
