import Link from "next/link";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { agent, type DailyMeetingT } from "@/lib/agent";
import { PM_KEYS, PM_NAME } from "@/lib/pm";
import { PageHeader } from "@/components/PageHeader";
import { AutoRefresh } from "@/components/autodev/AutoRefresh";
import { Avatar } from "@/components/rail/Avatar";
import { PmLog } from "@/components/org/PmChat";
import { CloseMeeting } from "@/components/org/CloseMeeting";

const HEALTH: Record<string, string> = { green: "bg-emerald-500", yellow: "bg-amber-400", red: "bg-rose-500" };

// 会議の画面：各 PM のレポート・PM どうしの突き合わせ・PdM と PM の対話
export default async function MeetingPage({ params }: { params: Promise<{ id: string; mid: string }> }) {
  const { id, mid } = await params;
  const [m, versions] = await Promise.all([
    agent<DailyMeetingT>(`/products/${id}/meetings-daily/${mid}`),
    agent<Record<string, string>>("/avatars").catch(() => ({} as Record<string, string>)),
  ]);
  return (
    <>
      <AutoRefresh active={m.status === "preparing"} ms={3000} />
      <PageHeader
        crumbs={<><Link href={`/p/${id}`} className="hover:text-zinc-700">ダッシュボード</Link><span>/</span><Link href={`/p/${id}/meetings-daily`} className="hover:text-zinc-700">振り返りの会議</Link><span>/</span><span>{m.day}</span></>}
        title={`${m.day} の振り返りの会議`}
        sub={m.status === "preparing" ? "PM がレポートと突き合わせを準備しています…" : m.status === "failed" ? "準備に失敗しました（ジョブの画面で理由を見られます）" : "各 PM のレポートと突き合わせを読み、PM と話してください。決めたことは PM が担当への Issue にします。"}
        actions={<>{m.job_id && <Link href={`/jobs/${m.job_id}`} className="btn-secondary">ジョブ</Link>}{m.status === "open" && <CloseMeeting pid={id} mid={m.id} />}</>}
      />
      <div className="space-y-6 px-8 py-6">
        <div className="grid gap-4 xl:grid-cols-3">
          {PM_KEYS.map((pm) => {
            const r = m.reports[pm];
            const about = m.reviews.filter((x) => x.about === pm);
            return (
              <section key={pm} className="card flex flex-col" aria-label={`${PM_NAME[pm]}のレポート`}>
                <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2.5">
                  <Avatar k={pm} v={versions[pm]} size={30} />
                  <h2 className="text-[14px] font-semibold">{PM_NAME[pm]}のレポート</h2>
                  {r && <span className={`ml-auto h-2.5 w-2.5 rounded-full ${HEALTH[r.health]}`} />}
                </div>
                <div className="prose-md max-h-[460px] flex-1 overflow-y-auto px-4 py-3">
                  {r ? <Markdown remarkPlugins={[remarkGfm]}>{r.text}</Markdown> : <p className="text-zinc-400">準備中…</p>}
                </div>
                {about.length > 0 && (
                  <div className="space-y-1.5 border-t border-zinc-100 px-4 py-3">
                    <div className="text-[11px] font-semibold text-zinc-500">他の PM の突き合わせ</div>
                    {about.map((x, i) => (
                      <div key={i} className={`flex gap-2 rounded-lg px-2 py-1.5 text-[12px] ${x.conflict ? "bg-rose-50 text-rose-900" : "bg-zinc-50 text-zinc-700"}`}>
                        {x.conflict ? <AlertTriangle size={13} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-emerald-600" />}
                        <span><b>{PM_NAME[x.pm]}</b>：{x.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
        {m.status !== "preparing" && (
          <div className="card"><PmLog pid={id} messages={m.messages ?? []} versions={versions} title="会議での対話" empty="このページを開いたまま画面下のチャットで話すと、会議での発言として PM が答えます。" height="max-h-[420px]" /></div>
        )}
      </div>
    </>
  );
}
