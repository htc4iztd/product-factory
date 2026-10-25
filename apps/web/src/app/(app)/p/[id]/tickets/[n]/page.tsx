import Link from "next/link";
import { agent, type Overview, type TicketDetail } from "@/lib/agent";
import { PageHeader } from "@/components/PageHeader";
import { ActionForm } from "@/components/team/ActionForm";
import { RefChips, RefText, when } from "@/components/team/RefText";
import { TicketFields } from "@/components/team/TicketFields";
import { commentTicket } from "../../team-actions";

export default async function TicketPage({ params }: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await params;
  const [t, ov] = await Promise.all([agent<TicketDetail>(`/products/${id}/tickets/${n}`), agent<Overview>(`/products/${id}`)]);
  const src = t.source;
  return (
    <>
      <PageHeader crumbs={<><Link href={`/p/${id}/tickets`} className="hover:text-zinc-700">チケット</Link><span>/</span><span>{t.key}</span></>}
        title={<><span className="font-mono text-base text-zinc-400">{t.key}</span>{t.title}</>}
        sub={<>作成：{t.created_by}・{when(t.created_at)}{src && <>・起点：{typeof src.id === "string" ? <RefText pid={id} text={src.id} /> : src.kind === "thread" ? "議論のスレッド" : src.kind}</>}</>} />
      <div className="grid gap-6 px-8 py-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-5">
          <section className="card p-5">
            <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-700">{t.body ? <RefText pid={id} text={t.body} /> : <span className="text-zinc-400">内容は未記入</span>}</div>
            {t.refs.length > 0 && <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500">つながり <RefChips pid={id} refs={t.refs} /></div>}
          </section>
          <section aria-label="コメント" className="space-y-3">
            <div className="section-title">コメント（{t.comments.length}）</div>
            {t.comments.map((c) => (
              <div key={c.id} className="card p-3 text-[13px]">
                <div className="mb-1 text-[11px] text-zinc-400"><span className="font-medium text-zinc-600">{c.author}</span>・{when(c.created_at)}</div>
                <div className="whitespace-pre-wrap"><RefText pid={id} text={c.body} /></div>
              </div>
            ))}
            <ActionForm action={commentTicket.bind(null, id, t.number)} submit="コメントする">
              <textarea name="body" aria-label="コメントを書く" rows={3} className="input" placeholder="@メールアドレス で知らせる。US-03 のように ID を書くとリンクになります" required />
            </ActionForm>
          </section>
        </div>
        <TicketFields pid={id} ticket={{ ...t, comments: t.comments.length }} stages={ov.stages.map((s) => ({ id: s.id, label: `${s.no} ${s.name}` }))} />
      </div>
    </>
  );
}
