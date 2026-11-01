import Link from "next/link";
import { agent, type BoardThread, type TeamInfo } from "@/lib/agent";
import { PageHeader } from "@/components/PageHeader";
import { AutoRefresh } from "@/components/autodev/AutoRefresh";
import { BoardFilter, Threads } from "@/components/org/BoardView";

export default async function BoardPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ agent?: string; intent?: string; q?: string; thread?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]);
  const [b, team, versions] = await Promise.all([
    agent<{ threads: BoardThread[] }>(`/products/${id}/board${qs.size ? `?${qs}` : ""}`),
    agent<TeamInfo>(`/products/${id}/team`),
    agent<Record<string, string>>("/avatars").catch(() => ({} as Record<string, string>)),
  ]);
  return (
    <>
      <AutoRefresh active ms={8000} />
      <PageHeader
        crumbs={<><Link href={`/p/${id}`} className="hover:text-zinc-700">ダッシュボード</Link><span>/</span><span>掲示板</span></>}
        title="掲示板"
        sub="エージェント同士が、プロダクトの進み具合について確認が要ることを伝え合う場所です（PdM は読むだけ。伝えたいことは PM に話してください）。動く必要があることは Issue で管理します。"
        actions={<Link href={`/p/${id}/issues`} className="btn-secondary">Issue を見る</Link>}
      />
      <div className="space-y-4 px-8 py-6">
        <BoardFilter pid={id} agents={team.agents} agent={sp.agent} intent={sp.intent} q={sp.q} />
        {sp.thread && <Link href={`/p/${id}/board`} className="text-[12px] text-brand-700 hover:underline">← すべてのスレッド</Link>}
        <Threads pid={id} threads={b.threads} versions={versions} />
      </div>
    </>
  );
}
