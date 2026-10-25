import Link from "next/link";
import { Plus } from "lucide-react";
import { agent, type Overview, type Ticket } from "@/lib/agent";
import { PageHeader } from "@/components/PageHeader";
import { ActionForm } from "@/components/team/ActionForm";
import { RefChips } from "@/components/team/RefText";
import { PRIORITY_STYLE, TICKET_STATUS } from "@/components/team/labels";
import { createTicket } from "../team-actions";

const COLUMNS = ["triage", "todo", "doing", "review", "done"] as const;

export default async function TicketsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ closed?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const [tickets, ov] = await Promise.all([agent<Ticket[]>(`/products/${id}/tickets`), agent<Overview>(`/products/${id}`)]);
  const closed = tickets.filter((t) => t.status === "closed");
  return (
    <>
      <PageHeader crumbs={<span>チーム</span>} title="チケット"
        sub="誰が・何を・どこまでやるか。US-03 や DEC-2 のように ID を書くと、成果物や決定記録とつながります。会話や会議から AI が起こした宿題は「仕分け待ち」に入ります。" />
      <div className="space-y-6 px-8 py-6">
        <details className="card p-4" open={tickets.length === 0}>
          <summary className="flex cursor-pointer items-center gap-1.5 text-[13px] font-medium"><Plus size={14} />チケットを作る</summary>
          <ActionForm action={createTicket.bind(null, id)} submit="作成" className="mt-3 grid gap-3 md:grid-cols-6">
            <div className="md:col-span-6"><label className="label" htmlFor="t-title">タイトル</label><input id="t-title" name="title" className="input" placeholder="例：US-03 の決済画面を作る" required /></div>
            <div className="md:col-span-6"><label className="label" htmlFor="t-body">内容</label><textarea id="t-body" name="body" rows={3} className="input" /></div>
            <div><label className="label" htmlFor="t-pri">優先度</label><select id="t-pri" name="priority" className="input" defaultValue="P2"><option>P1</option><option>P2</option><option>P3</option></select></div>
            <div className="md:col-span-2"><label className="label" htmlFor="t-as">担当（メールアドレス）</label><input id="t-as" name="assignee" className="input" /></div>
            <div><label className="label" htmlFor="t-st">ステージ</label><select id="t-st" name="stage_id" className="input"><option value="">—</option>{ov.stages.map((s) => <option key={s.id} value={s.id}>{s.no} {s.name}</option>)}</select></div>
            <div className="md:col-span-2"><label className="label" htmlFor="t-due">期日</label><input id="t-due" name="due" type="date" className="input" /></div>
          </ActionForm>
        </details>
        <div className="grid gap-3 lg:grid-cols-5">
          {COLUMNS.map((col) => {
            const items = tickets.filter((t) => t.status === col);
            return (
              <section key={col} aria-label={TICKET_STATUS[col]} className="min-w-0 rounded-xl bg-zinc-100/70 p-2">
                <div className="mb-2 flex items-center justify-between px-1 text-xs font-medium text-zinc-600">
                  <span>{TICKET_STATUS[col]}</span><span className="text-zinc-400">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((t) => (
                    <Link key={t.number} href={`/p/${id}/tickets/${t.number}`} className="card block p-3 transition hover:shadow-pop">
                      <div className="mb-1 flex items-center gap-1.5 text-[11px]">
                        <span className="font-mono text-zinc-400">{t.key}</span>
                        <span className={`chip ${PRIORITY_STYLE[t.priority]}`}>{t.priority}</span>
                        {t.due && <span className="ml-auto text-zinc-400">{t.due}</span>}
                      </div>
                      <div className="text-[13px] font-medium leading-snug">{t.title}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-zinc-500">
                        {t.assignee && <span className="truncate">{t.assignee}</span>}
                        {!!t.comments && <span className="text-zinc-400">💬 {t.comments}</span>}
                      </div>
                      {t.refs.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{t.refs.slice(0, 4).map((r) => <span key={r} className="chip font-mono">{r}</span>)}</div>}
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
        {closed.length > 0 && (
          <div className="text-xs text-zinc-500">
            {sp.closed ? (
              <div className="space-y-1">
                <div className="section-title">閉じたチケット</div>
                {closed.map((t) => <div key={t.number}><Link className="hover:underline" href={`/p/${id}/tickets/${t.number}`}>{t.key} {t.title}</Link> <RefChips pid={id} refs={t.refs} /></div>)}
              </div>
            ) : <Link href={`/p/${id}/tickets?closed=1`} className="hover:underline">閉じたチケット（{closed.length}）を見る</Link>}
          </div>
        )}
      </div>
    </>
  );
}
