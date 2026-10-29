import Link from "next/link";
import { agent, type BoardThread, type TeamMember } from "@/lib/agent";
import { PageHeader } from "@/components/PageHeader";
import { AutoRefresh } from "@/components/autodev/AutoRefresh";
import { BoardFilter, Composer, Threads } from "@/components/org/BoardView";

export default async function BoardPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ agent?: string; intent?: string; q?: string; thread?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]);
  const [b, team] = await Promise.all([
    agent<{ threads: BoardThread[] }>(`/products/${id}/board${qs.size ? `?${qs}` : ""}`),
    agent<{ agents: TeamMember[] }>(`/products/${id}/team`),
  ]);
  return (
    <>
      <AutoRefresh active ms={8000} />
      <PageHeader
        crumbs={<><Link href={`/p/${id}`} className="hover:text-zinc-700">ダッシュボード</Link><span>/</span><span>掲示板</span></>}
        title="掲示板"
        sub="司令塔・PM・各工程の担当と PdM のやり取りをすべて残します。誰が、いつ、誰に、何を言い、どう決めたかを追えます。返信や追加の指示を書くと、宛先のエージェントがすぐ動きます。"
      />
      <div className="space-y-4 px-8 py-6">
        <BoardFilter pid={id} agents={team.agents} agent={sp.agent} intent={sp.intent} q={sp.q} />
        {sp.thread && <Link href={`/p/${id}/board`} className="text-[12px] text-brand-700 hover:underline">← すべてのスレッド</Link>}
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Threads pid={id} threads={b.threads} agents={team.agents} />
          <div className="space-y-3">
            <Composer pid={id} agents={team.agents} />
          </div>
        </div>
      </div>
    </>
  );
}
