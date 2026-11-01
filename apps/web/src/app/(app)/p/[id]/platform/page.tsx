import Link from "next/link";
import { agent, type PlatformWorkspace } from "@/lib/agent";
import { PageHeader } from "@/components/PageHeader";
import { AutoRefresh } from "@/components/autodev/AutoRefresh";
import { Avatar } from "@/components/rail/Avatar";
import { FindingList, PlatformChat } from "@/components/org/PlatformPanel";

const when = (t: string | null) => (t ? new Date(t).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—");
const ago = (t: string | null, now: string) => {
  if (!t) return "記録なし";
  const m = Math.floor((new Date(now).getTime() - new Date(t).getTime()) / 60000);
  return m < 1 ? "1分以内" : m < 120 ? `${m}分前` : `${Math.floor(m / 60)}時間前`;
};
const BEAT: Record<string, string> = { tick: "定期実行（tick・毎分）", platform: "プラットフォームの見回り（5分ごと）" };

// プラットフォーム：ファクトリー全体（このテナントのすべてのプロダクト）が動いているかを見張り、PdM と直接話す
export default async function PlatformPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [w, versions] = await Promise.all([
    agent<PlatformWorkspace>("/platform"),
    agent<Record<string, string>>("/avatars").catch(() => ({} as Record<string, string>)),
  ]);
  const st = w.status;
  return (
    <>
      <AutoRefresh active ms={15000} />
      <PageHeader
        crumbs={<><Link href={`/p/${id}`} className="hover:text-zinc-700">ダッシュボード</Link><span>/</span><span>プラットフォーム</span></>}
        title={<span className="flex items-center gap-3"><Avatar k="platform" v={versions.platform} size={44} state={w.summary.high ? "stuck" : "idle"} />プラットフォーム</span>}
        sub="ファクトリー全体（すべてのプロダクト）の稼働を見張ります。各エージェントの実行状況・稼働上の問題・処理系の要修正点を見つけ、PdM と直接話します"
      />
      <div className="space-y-6 px-8 py-6">
        <section className="grid gap-3 md:grid-cols-4" aria-label="稼働状況">
          <div className={`card p-4 ${st.scheduler.healthy ? "" : "ring-1 ring-rose-300"}`}>
            <div className="text-[11px] text-zinc-500">定期実行</div>
            <div className={`mt-1 text-[18px] font-semibold ${st.scheduler.healthy ? "text-emerald-700" : "text-rose-600"}`}>{st.scheduler.healthy ? "動いています" : "止まっています"}</div>
            {Object.entries(st.scheduler.beats).map(([k, b]) => (
              <div key={k} className="mt-1 text-[11px] text-zinc-500" title={b.detail}>{BEAT[k] ?? k}：{ago(b.at, st.now)}</div>
            ))}
          </div>
          <div className="card p-4">
            <div className="text-[11px] text-zinc-500">未対応の問題</div>
            <div className={`mt-1 text-[18px] font-semibold ${w.summary.high ? "text-rose-600" : w.summary.open ? "text-amber-600" : "text-emerald-700"}`}>{w.summary.open} 件</div>
            <div className="mt-1 text-[11px] text-zinc-500">うち重い {w.summary.high} 件</div>
          </div>
          <div className="card p-4">
            <div className="text-[11px] text-zinc-500">ジョブ（24時間）</div>
            <div className="mt-1 text-[18px] font-semibold">
              成功 {st.jobs.reduce((n, j) => n + j.done, 0)}・<span className={st.jobs.some((j) => j.failed) ? "text-rose-600" : ""}>失敗 {st.jobs.reduce((n, j) => n + j.failed, 0)}</span>
            </div>
            <div className="mt-1 text-[11px] text-zinc-500">いま動いている {st.running.length} 件</div>
          </div>
          <div className="card p-4">
            <div className="text-[11px] text-zinc-500">見回った時刻</div>
            <div className="mt-1 text-[14px] font-semibold">{when(st.now)}</div>
            <div className="mt-1 text-[11px] text-zinc-500">この画面は15秒ごとに読み直します</div>
          </div>
        </section>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="space-y-6">
            <FindingList pid={id} findings={w.findings} />
            <section className="card" aria-label="プロダクトごとのエージェント">
              <h2 className="border-b border-zinc-100 px-4 py-2.5 text-[14px] font-semibold">プロダクトごとのエージェントの実行状況</h2>
              <table className="w-full text-[12px]">
                <thead className="text-left text-[11px] text-zinc-500"><tr><th className="px-4 py-1.5">プロダクト</th><th>作業中</th><th>詰まり</th><th>待機</th><th>停止</th><th>Issue</th><th>次の定期実行</th></tr></thead>
                <tbody className="divide-y divide-zinc-100">
                  {st.products.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-1.5"><Link href={`/p/${p.id}`} className="font-medium hover:underline">{p.name}</Link></td>
                      <td className="text-brand-700">{p.agents.working ?? 0}</td>
                      <td className={p.agents.stuck ? "font-medium text-rose-600" : ""}>{p.agents.stuck ?? 0}</td>
                      <td>{p.agents.idle ?? 0}</td>
                      <td className="text-zinc-400">{p.agents.off ?? 0}</td>
                      <td>{p.open_issues}</td>
                      <td className="text-zinc-500">{when(p.next_run_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className="card" aria-label="ジョブ">
              <h2 className="border-b border-zinc-100 px-4 py-2.5 text-[14px] font-semibold">ジョブの種類ごと（24時間）</h2>
              {st.jobs.length === 0 && <p className="px-4 py-3 text-[12px] text-zinc-400">24時間のジョブはありません</p>}
              <ul className="divide-y divide-zinc-100">
                {st.jobs.map((j) => (
                  <li key={j.kind} className="flex items-center gap-2 px-4 py-1.5 text-[12px]">
                    <span className="min-w-0 flex-1 truncate">{j.name}</span>
                    <span className="text-emerald-700">成功 {j.done}</span>
                    <span className={j.failed ? "font-medium text-rose-600" : "text-zinc-400"}>失敗 {j.failed}</span>
                    <span className="text-zinc-500">実行中 {j.running}</span>
                  </li>
                ))}
              </ul>
              {st.running.length > 0 && (
                <div className="border-t border-zinc-100 px-4 py-2 text-[11.5px] text-zinc-500">
                  いま動いている：{st.running.map((r) => `${r.name}${r.product_name ? `（${r.product_name}）` : ""}`).join("、")}
                  <Link href="/jobs" className="ml-2 text-brand-700 hover:underline">ジョブの画面</Link>
                </div>
              )}
            </section>
          </div>
          <PlatformChat pid={id} messages={w.messages} version={versions.platform} />
        </div>
      </div>
    </>
  );
}
