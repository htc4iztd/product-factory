import Link from "next/link";
import { FileText } from "lucide-react";
import { agent, type DocSummary } from "@/lib/agent";
import { PageHeader } from "@/components/PageHeader";
import { ActionForm } from "@/components/team/ActionForm";
import { RefChips, when } from "@/components/team/RefText";
import { createDoc } from "../team-actions";

export default async function DocsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const list = await agent<DocSummary[]>(`/products/${id}/docs`);
  return (
    <>
      <PageHeader crumbs={<span>チーム</span>} title="ドキュメント"
        sub="成果物にならないメモ・調査・手順など。Markdown で書き、US-03 や DEC-2 のように ID を書くとつながります。" />
      <div className="mx-auto max-w-4xl space-y-6 px-8 py-6">
        <ActionForm action={createDoc.bind(null, id)} submit="作成" className="card flex items-end gap-3 p-4">
          <div className="flex-1"><label className="label" htmlFor="doc-title">新しいドキュメントのタイトル</label><input id="doc-title" name="title" className="input" required /></div>
        </ActionForm>
        <div className="card divide-y divide-zinc-100">
          {list.length === 0 && <p className="p-5 text-[13px] text-zinc-400">まだドキュメントがありません。</p>}
          {list.map((d) => (
            <div key={d.key} className="flex items-center gap-3 px-5 py-3 text-[13px]">
              <FileText size={14} className="text-zinc-400" />
              <Link href={`/p/${id}/docs/${d.number}`} className="font-medium hover:underline">{d.title}</Link>
              <span className="font-mono text-xs text-zinc-400">{d.key}</span>
              <RefChips pid={id} refs={d.refs} />
              <span className="ml-auto text-xs text-zinc-500">{d.updated_by}・{when(d.updated_at)}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
