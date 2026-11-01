import Link from "next/link";
import { agent } from "@/lib/agent";
import { PageHeader } from "@/components/PageHeader";
import { ScheduleBoard, ScheduleOverview, type OverviewRow, type ScheduleView } from "@/components/org/Schedule";

// 定期実行の予定：このプロダクトの時間割と、すべてのプロダクトの予定。予定は cron を書かずに選ぶ
export default async function SchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [v, o, versions] = await Promise.all([
    agent<ScheduleView>(`/products/${id}/schedule`),
    agent<{ products: OverviewRow[] }>("/schedule-overview"),
    agent<Record<string, string>>("/avatars").catch(() => ({} as Record<string, string>)),
  ]);
  return (
    <>
      <PageHeader
        crumbs={<><Link href={`/p/${id}`} className="hover:text-zinc-700">ダッシュボード</Link><span>/</span><span>スケジュール</span></>}
        title="スケジュール"
        sub="エージェントが定期的に動く予定。毎分の呼び出しで、時刻が来たエージェントだけが動きます（担当は手を動かす Issue があるときだけ AI を使います）"
      />
      <div className="space-y-6 px-8 py-6">
        <ScheduleBoard pid={id} v={v} versions={versions} />
        <ScheduleOverview rows={o.products} />
      </div>
    </>
  );
}
