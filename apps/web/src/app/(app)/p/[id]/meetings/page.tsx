import Link from "next/link";
import { Plus } from "lucide-react";
import { agent, type Meeting } from "@/lib/agent";
import { PageHeader } from "@/components/PageHeader";
import { ActionForm } from "@/components/team/ActionForm";
import { PROVIDERS } from "@/components/team/labels";
import { createMeeting } from "../team-actions";

export default async function MeetingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const list = await agent<Meeting[]>(`/products/${id}/meetings`);
  return (
    <>
      <PageHeader crumbs={<span>チーム</span>} title="会議"
        sub="会議の記録（文字起こし）を入れると、AI が議事録を作り、決まったことを決定記録（確定待ち）に、宿題をチケット（仕分け待ち）にします。" />
      <div className="mx-auto max-w-4xl space-y-6 px-8 py-6">
        <details className="card p-4" open={list.length === 0}>
          <summary className="flex cursor-pointer items-center gap-1.5 text-[13px] font-medium"><Plus size={14} />会議を作る</summary>
          <ActionForm action={createMeeting.bind(null, id)} submit="作成" className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2"><label className="label" htmlFor="m-title">会議名</label><input id="m-title" name="title" className="input" placeholder="例：週次定例" required /></div>
            <div><label className="label" htmlFor="m-at">日時</label><input id="m-at" name="starts_at" type="datetime-local" className="input" /></div>
            <div><label className="label" htmlFor="m-att">参加者（カンマ区切り）</label><input id="m-att" name="attendees" className="input" /></div>
            <div><label className="label" htmlFor="m-prov">会議の場所（任意）</label>
              <select id="m-prov" name="provider" className="input"><option value="">—</option><option value="meet">Google Meet</option><option value="teams">Microsoft Teams</option><option value="other">その他</option></select></div>
            <div><label className="label" htmlFor="m-url">会議・録画の URL</label><input id="m-url" name="url" className="input" /></div>
          </ActionForm>
        </details>
        <div className="card divide-y divide-zinc-100">
          {list.length === 0 && <p className="p-5 text-[13px] text-zinc-400">まだ会議がありません。</p>}
          {list.map((m) => (
            <Link key={m.key} href={`/p/${id}/meetings/${m.number}`} className="flex items-center gap-3 px-5 py-3 text-[13px] hover:bg-zinc-50">
              <span className="font-mono text-xs text-zinc-400">{m.key}</span>
              <span className="font-medium">{m.title}</span>
              {m.source?.provider && <span className="chip">{PROVIDERS[m.source.provider] ?? m.source.provider}</span>}
              <span className="ml-auto text-xs text-zinc-500">{m.starts_at?.replace("T", " ") ?? ""}</span>
              <span className={`chip ${m.has_minutes ? "border-emerald-200 bg-emerald-50 text-emerald-700" : ""}`}>{m.has_minutes ? "議事録あり" : "議事録なし"}</span>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
