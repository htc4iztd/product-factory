import Link from "next/link";
import { agent, type AgentCatalog } from "@/lib/agent";
import { auth } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { Cast } from "@/components/org/Cast";

// ペルソナ・スキル・ツール：エージェントごとの人物像と、使えるスキル・ツールの割り当て（テナントで共通）
export default async function CastPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [cat, versions, session] = await Promise.all([
    agent<AgentCatalog>("/agent-catalog"),
    agent<Record<string, string>>("/avatars").catch(() => ({} as Record<string, string>)),
    auth(),
  ]);
  const canEdit = ["OWNER", "ADMIN"].includes(session?.user?.role ?? "");
  return (
    <>
      <PageHeader
        crumbs={<><Link href={`/p/${id}`} className="hover:text-zinc-700">ダッシュボード</Link><span>/</span><span>ペルソナ・スキル・ツール</span></>}
        title="ペルソナ・スキル・ツール"
        sub="エージェントごとの人物像と、直結するスキル・参照スキル・使ってよいツール。テナントのすべてのプロダクトで共通の配役です"
      />
      <div className="px-8 py-6"><Cast pid={id} cat={cat} versions={versions} canEdit={canEdit} /></div>
    </>
  );
}
