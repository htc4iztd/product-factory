import Link from "next/link";
import { agent, type DailyMeetingT } from "@/lib/agent";
import { PageHeader } from "@/components/PageHeader";

const STATUS: Record<string, string> = { preparing: "準備中", open: "開いている", closed: "終わった", failed: "失敗" };

export default async function MeetingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const list = await agent<DailyMeetingT[]>(`/products/${id}/meetings-daily`);
  return (
    <>
      <PageHeader
        crumbs={<><Link href={`/p/${id}`} className="hover:text-zinc-700">ダッシュボード</Link><span>/</span><span>振り返りの会議</span></>}
        title="振り返りの会議"
        sub="PdM と3人の PM が1日1回振り返ります。PM は前回からの担当の実行状況と課題をレポートし、他の PM のレポートと自分の領域の成果物を突き合わせます。"
      />
      <div className="px-8 py-6">
        <div className="card divide-y divide-zinc-100">
          {list.length === 0 && <p className="px-4 py-4 text-[13px] text-zinc-400">まだありません（ダッシュボードの「いま会議を始める」か、予定の時刻に始まります）</p>}
          {list.map((m) => (
            <Link key={m.id} href={`/p/${id}/meetings-daily/${m.id}`} className="flex items-center gap-3 px-4 py-2.5 text-[13px] hover:bg-zinc-50">
              <span className="font-medium">{m.day}</span>
              <span className="rounded bg-zinc-100 px-1.5 text-[11px]">{STATUS[m.status]}</span>
              {m.reviews.some((r) => r.conflict) && <span className="text-[12px] text-rose-600">食い違い {m.reviews.filter((r) => r.conflict).length}</span>}
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
