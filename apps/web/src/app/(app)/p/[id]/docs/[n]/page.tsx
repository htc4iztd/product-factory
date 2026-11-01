import Link from "next/link";
import { agent, type DocDetail, type Overview } from "@/lib/agent";
import { ReadersEditor } from "@/components/import/ReadersEditor";
import { PageHeader } from "@/components/PageHeader";
import { DocForm } from "@/components/team/DocForm";
import { RefChips, when } from "@/components/team/RefText";

export default async function DocPage({ params }: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await params;
  const [d, ov, versions] = await Promise.all([
    agent<DocDetail>(`/products/${id}/docs/${n}`), agent<Overview>(`/products/${id}`),
    agent<Record<string, string>>("/avatars").catch(() => ({} as Record<string, string>)),
  ]);
  return (
    <>
      <PageHeader crumbs={<><Link href={`/p/${id}/docs`} className="hover:text-zinc-700">ドキュメント</Link><span>/</span><span>{d.key}</span></>}
        title={<><span className="font-mono text-base text-zinc-400">{d.key}</span>{d.title}</>}
        sub={<span className="flex items-center gap-2">最終更新：{d.updated_by}・{when(d.updated_at)} <RefChips pid={id} refs={d.refs} /></span>} />
      <div className="space-y-4 px-8 py-6">
        <DocForm pid={id} doc={d} />
        <ReadersEditor key={d.readers.join()} kind="doc" pid={id} doc={d.number} readers={d.readers} custom={d.readers_custom} stages={ov.stages} versions={versions} />
      </div>
    </>
  );
}
