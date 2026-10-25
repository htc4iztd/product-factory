import Link from "next/link";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { agent, type MeetingDetail } from "@/lib/agent";
import { PageHeader } from "@/components/PageHeader";
import { MeetingForm } from "@/components/team/MeetingForm";
import { DECISION_STATUS, TICKET_STATUS } from "@/components/team/labels";

export default async function MeetingPage({ params }: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await params;
  const m = await agent<MeetingDetail>(`/products/${id}/meetings/${n}`);
  return (
    <>
      <PageHeader crumbs={<><Link href={`/p/${id}/meetings`} className="hover:text-zinc-700">会議</Link><span>/</span><span>{m.key}</span></>}
        title={<><span className="font-mono text-base text-zinc-400">{m.key}</span>{m.title}</>}
        sub={<>{m.starts_at?.replace("T", " ")}{m.attendees.length > 0 && `・${m.attendees.join("、")}`}{m.source?.url && <>・<a href={m.source.url} target="_blank" rel="noreferrer" className="underline">会議の場所</a></>}</>} />
      <div className="grid gap-6 px-8 py-6 xl:grid-cols-2">
        <MeetingForm pid={id} meeting={m} />
        <div className="space-y-4">
          <section className="card p-5" aria-label="議事録">
            <div className="section-title mb-2">議事録</div>
            {m.minutes ? <div className="prose-md"><Markdown remarkPlugins={[remarkGfm]}>{m.minutes}</Markdown></div>
              : <p className="text-[13px] text-zinc-400">文字起こしを入れて「保存して議事録を作る」を押すと、ここに出ます。</p>}
          </section>
          {(m.decisions.length > 0 || m.tickets.length > 0) && (
            <section className="card space-y-2 p-5 text-[13px]">
              <div className="section-title">この会議から起きたもの</div>
              {m.decisions.map((d) => <div key={d.key}><Link className="hover:underline" href={`/p/${id}/decisions#${d.key}`}><span className="font-mono text-zinc-400">{d.key}</span> {d.title}</Link> <span className="chip">{DECISION_STATUS[d.status]}</span></div>)}
              {m.tickets.map((t) => <div key={t.key}><Link className="hover:underline" href={`/p/${id}/tickets/${t.number}`}><span className="font-mono text-zinc-400">{t.key}</span> {t.title}</Link> <span className="chip">{TICKET_STATUS[t.status]}</span>{t.assignee && <span className="ml-1 text-xs text-zinc-500">{t.assignee}</span>}</div>)}
            </section>
          )}
        </div>
      </div>
    </>
  );
}
