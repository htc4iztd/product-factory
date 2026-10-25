import Link from "next/link";
import { agent, type DocDetail } from "@/lib/agent";
import { PageHeader } from "@/components/PageHeader";
import { DocForm } from "@/components/team/DocForm";
import { RefChips, when } from "@/components/team/RefText";

export default async function DocPage({ params }: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await params;
  const d = await agent<DocDetail>(`/products/${id}/docs/${n}`);
  return (
    <>
      <PageHeader crumbs={<><Link href={`/p/${id}/docs`} className="hover:text-zinc-700">ドキュメント</Link><span>/</span><span>{d.key}</span></>}
        title={<><span className="font-mono text-base text-zinc-400">{d.key}</span>{d.title}</>}
        sub={<span className="flex items-center gap-2">最終更新：{d.updated_by}・{when(d.updated_at)} <RefChips pid={id} refs={d.refs} /></span>} />
      <div className="px-8 py-6"><DocForm pid={id} doc={d} /></div>
    </>
  );
}
