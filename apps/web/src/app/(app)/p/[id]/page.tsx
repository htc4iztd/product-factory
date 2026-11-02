import Link from "next/link";
import { AlertTriangle, CalendarClock, CheckCircle2, CircleDashed, Clock, ListChecks } from "lucide-react";
import { agent, type AgentIssueT, type ApprovalItem, type CycleState, type Dashboard } from "@/lib/agent";
import { StartReviewButton } from "@/components/review/ReviewForms";
import { ApprovalInbox } from "@/components/org/ApprovalInbox";
import { PageHeader } from "@/components/PageHeader";
import { AutoRefresh } from "@/components/autodev/AutoRefresh";
import { TeamGraph } from "@/components/org/TeamGraph";
import { RunTeamButton } from "@/components/org/bits";
import { MeetingCard } from "@/components/org/MeetingCard";

const when = (t: string | null | undefined) => (t ? new Date(t).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

// ダッシュボード：工程どうしのつながりと進み具合を、各エージェントが報告する。PdM は PM と話し、毎日の会議で振り返る
export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [d, issues, team, approvals, cy] = await Promise.all([
    agent<Dashboard>(`/products/${id}/dashboard`),
    agent<AgentIssueT[]>(`/products/${id}/issues?open_only=true`),
    agent<{ beats?: Record<string, { at: string; detail: string }> }>(`/products/${id}/team`),
    agent<ApprovalItem[]>(`/products/${id}/approvals`).catch(() => [] as ApprovalItem[]),
    agent<CycleState>(`/products/${id}/cycle`).catch(() => null),
  ]);
  const review = !!cy && cy.state !== "running";
  const toRelease = !!cy && ["onboarding", "prerelease", "releasing"].includes(cy.state);
  const NEXT: Record<string, string> = {
    review: "各 PM のレビューを読み、直すところを PM に指示してください。",
    onboarding: "リリースエージェントが、リリース先の環境と方式を定義しています。",
    prerelease: "リリースの定義を確かめ、承認するか直させてください。",
    releasing: "接続先でリリースしています。",
    done: "次のサイクルの戦略を決めて始めてください。",
  };
  const active = d.stages.filter((s) => s.enabled);
  const done = active.filter((s) => s.status === "completed").length;
  const waiting = active.filter((s) => s.pending_kind === "approval");
  const recheck = active.filter((s) => s.status === "needs_recheck");
  // 進み具合は、このサイクルの工程ごとの%（確定済みは100、そうでなければ担当の報告）の平均
  const pct = cy ? cy.progress.total : active.length ? Math.round((done / active.length) * 100) : 0;
  const tick = team.beats?.tick;
  const stale = !tick || Date.now() - new Date(tick.at).getTime() > 5 * 60 * 1000;
  const stats = [
    { label: "更新済み", value: `${done} / ${active.length}`, icon: CheckCircle2, tone: "text-emerald-600" },
    { label: "承認待ち", value: waiting.length, icon: Clock, tone: "text-amber-600" },
    { label: "要再確認", value: recheck.length, icon: AlertTriangle, tone: "text-rose-600" },
    { label: "動いている Issue", value: issues.length, icon: ListChecks, tone: "text-violet-600" },
    { label: "止まっている担当", value: d.agents.filter((a) => a.report?.health === "red").length, icon: CircleDashed, tone: "text-rose-600" },
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
          <Link href={`/p/${id}/issues`} className="btn-secondary">Issue</Link>
          <Link href={`/p/${id}/board`} className="btn-secondary">掲示板</Link>
        </>}
      >
        <div className="mt-5 flex items-center gap-3">
          {cy && <Link href={`/p/${id}/review`} className="whitespace-nowrap rounded-full bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-white" title="サイクルの計画とプロダクトレビュー">サイクル {cy.cycle}{cy.current.label ? `：${cy.current.label}` : ""}{cy.plan.length > 1 ? `（全 ${cy.plan.length}）` : ""}</Link>}
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100">
            <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-violet-500" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs tabular-nums text-zinc-500">{pct}%</span>
          <span className={`flex items-center gap-1 text-[11px] ${stale ? "text-rose-600" : "text-zinc-400"}`} title={tick?.detail}>
            <CalendarClock size={12} />定期実行：{tick ? `最後の確認 ${when(tick.at)}` : "まだ一度も動いていません"}{stale && tick ? "（止まっているかもしれません）" : ""}
          </span>
        </div>
      </PageHeader>
      <div className="space-y-6 px-8 py-6">
        {review && (
          <section className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-5 py-3" aria-label={cy!.state_label}>
            <div className="min-w-0 flex-1 text-[13px] text-amber-900">
              <span className="font-semibold">{cy!.state_label}（サイクル {cy!.cycle}）</span>：{NEXT[cy!.state]}その間、エージェントの定期実行は止めています。
            </div>
            <Link href={`/p/${id}/${toRelease ? "release" : "review"}`} className="btn-primary">{toRelease ? "リリースを開く" : cy!.state === "done" ? "次のサイクルへ" : "レビューを開く"}</Link>
          </section>
        )}
        {cy && !review && cy.progress.complete && (
          <section className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-5 py-3">
            <div className="min-w-0 flex-1 text-[13px] text-emerald-900">全工程が100%になりました。まもなくプロダクトレビューに入ります。</div>
            <StartReviewButton pid={id} complete />
          </section>
        )}
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {stats.map(({ label, value, icon: Icon, tone }) => (
            <div key={label} className="card p-4">
              <div className="flex items-center gap-2 text-xs text-zinc-500"><Icon size={14} className={tone} />{label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
            </div>
          ))}
        </section>
        <ApprovalInbox pid={id} items={approvals} />
        <TeamGraph d={d} pid={id} />
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="space-y-6">
            <MeetingCard pid={id} meeting={d.meeting_today} schedule={d.meeting} pending={d.pending_notes} />
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
