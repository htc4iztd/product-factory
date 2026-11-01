import Link from "next/link";
import { agent, type TeamInfo } from "@/lib/agent";
import { PageHeader } from "@/components/PageHeader";
import { AutoRefresh } from "@/components/autodev/AutoRefresh";
import { MeetingSchedule, OrgSettings } from "@/components/org/OrgSettings";
import { RunTeamButton } from "@/components/org/bits";

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [team, versions] = await Promise.all([
    agent<TeamInfo>(`/products/${id}/team`),
    agent<Record<string, string>>("/avatars").catch(() => ({} as Record<string, string>)),
  ]);
  return (
    <>
      <AutoRefresh active ms={10000} />
      <PageHeader
        crumbs={<><Link href={`/p/${id}`} className="hover:text-zinc-700">ダッシュボード</Link><span>/</span><span>エージェントの組織</span></>}
        title="エージェントの組織"
        sub="事業 PM（①〜⑤）・設計 PM（⑥〜⑪）・実装 PM（⑫〜⑭）と各工程の担当。PM は1時間ごとに担当の状況を確かめ、担当は10分ごとに自分宛ての Issue を確かめて実行します。"
        actions={<><Link href={`/p/${id}/cast`} className="btn-secondary btn-sm">ペルソナ・スキル・ツール</Link><RunTeamButton pid={id} running={false} /></>}
      />
      <div className="space-y-6 px-8 py-6">
        <MeetingSchedule pid={id} meeting={team.meeting} beats={team.beats} />
        <OrgSettings pid={id} agents={team.agents} versions={versions} />
      </div>
    </>
  );
}
