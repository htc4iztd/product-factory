import Link from "next/link";
import { AlertTriangle, CheckCircle2, CircleDashed, Clock, MessagesSquare } from "lucide-react";
import { agent, type Dashboard } from "@/lib/agent";
import { PageHeader } from "@/components/PageHeader";
import { AutoRefresh } from "@/components/autodev/AutoRefresh";
import { TeamGraph } from "@/components/org/TeamGraph";
import { DirectorChat, PdmInbox, RunTeamButton } from "@/components/org/DirectorChat";

// ダッシュボード：工程どうしのつながりと進み具合を、各エージェントが報告する。案ごとの状況もグラフで見る
export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await agent<Dashboard>(`/products/${id}/dashboard`);
  const active = d.stages.filter((s) => s.enabled);
  const done = active.filter((s) => s.status === "completed").length;
  const waiting = active.filter((s) => s.pending_kind === "approval");
  const recheck = active.filter((s) => s.status === "needs_recheck");
  const pct = active.length ? Math.round((done / active.length) * 100) : 0;
  const reds = d.agents.filter((a) => a.report?.health === "red");
  const stats = [
    { label: "更新済み", value: `${done} / ${active.length}`, icon: CheckCircle2, tone: "text-emerald-600" },
    { label: "承認待ち", value: waiting.length, icon: Clock, tone: "text-amber-600" },
    { label: "要再確認", value: recheck.length, icon: AlertTriangle, tone: "text-rose-600" },
    { label: "PdM 宛て（未読）", value: d.pdm_unread, icon: MessagesSquare, tone: "text-brand-600" },
    { label: "止まっている担当", value: reds.length, icon: CircleDashed, tone: "text-rose-600" },
  ];
  return (
    <>
      <AutoRefresh active ms={d.running ? 3000 : 8000} />
      <PageHeader
        crumbs={<span>ダッシュボード</span>}
        title={d.product.name}
        sub={d.product.idea || "意図は未記入"}
        actions={<>
          <RunTeamButton pid={id} running={d.running} />
          <Link href={`/p/${id}/board`} className="btn-secondary">掲示板</Link>
          <Link href={`/p/${id}/import`} className="btn-secondary">資料を取り込む</Link>
        </>}
      >
        {d.product.status === "stopped" && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">このプロダクトは中止されました。</div>
        )}
        <div className="mt-5 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100">
            <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-violet-500" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs tabular-nums text-zinc-500">{pct}%</span>
        </div>
      </PageHeader>
      <div className="space-y-6 px-8 py-6">
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {stats.map(({ label, value, icon: Icon, tone }) => (
            <div key={label} className="card p-4">
              <div className="flex items-center gap-2 text-xs text-zinc-500"><Icon size={14} className={tone} />{label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
            </div>
          ))}
        </section>
        <TeamGraph d={d} pid={id} />
        <div className="grid gap-6 xl:grid-cols-2">
          <DirectorChat pid={id} v={d.director} />
          <div className="space-y-6">
            <PdmInbox pid={id} posts={d.to_pdm} findings={d.findings_open} />
            {(waiting.length > 0 || recheck.length > 0) && (
              <section>
                <h2 className="section-title mb-2">対応が必要</h2>
                <div className="card divide-y divide-zinc-100">
                  {[...waiting.map((s) => ({ s, why: "承認待ち" })), ...recheck.map((s) => ({ s, why: "上流が更新されました" }))].map(({ s, why }) => (
                    <Link key={s.id + why} href={`/p/${id}/s/${s.id}`} className="flex items-center gap-3 px-4 py-3 text-[13px] hover:bg-zinc-50">
                      <span className="w-5 text-zinc-400">{s.no}</span><span className="font-medium">{s.name}</span>
                      <span className="text-zinc-500">{why}</span>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
