import Link from "next/link";
import { Md } from "@/components/md/Md";
import { Target } from "lucide-react";
import { agent, type ReviewData } from "@/lib/agent";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { CyclePlanEditor, NextCycleForm, StartReviewButton } from "@/components/review/ReviewForms";
import { ReviewRounds } from "@/components/review/ReviewRounds";
import { AutoRefresh } from "@/components/autodev/AutoRefresh";
import { auth } from "@/lib/auth";
import { ProtoPreview } from "@/components/ui-design/ProtoPreview";

const when = (t: string | null) => (t ? new Date(t).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const PM_NAME: Record<string, string> = { pm_biz: "事業PM", pm_design: "設計PM", pm_impl: "実装PM" };
const PHASE: Record<string, string> = { P1: "探索", P2: "事業定義", P3: "要求・設計", P4: "構築", P5: "リリース" };

// プロダクトレビュー：サイクルが終わったら、全工程の成果物を1つの画面で読み、次のサイクルの戦略と PM への追加指示を決める
export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [r, session] = await Promise.all([agent<ReviewData>(`/products/${id}/review`), auth()]);
  const viewer = session?.user?.role === "VIEWER";
  const review = r.state === "review";
  const rounds = r.current.review?.rounds ?? [];
  const busy = rounds.some((x) => x.status === "reviewing" || x.status === "fixing") || ["onboarding", "releasing"].includes(r.state);
  const stageName = Object.fromEntries(r.deliverables.map((d) => [d.id, `${d.no}${d.name}`]));
  const RELEASE_STATES = ["onboarding", "prerelease", "releasing"];
  const phases = [...new Set(r.deliverables.map((d) => d.phase))];
  return (
    <>
      <PageHeader
        crumbs={<><Link href={`/p/${id}`} className="hover:text-zinc-700">ダッシュボード</Link><span>/</span><span>プロダクトレビュー</span></>}
        title={`プロダクトレビュー（サイクル ${r.cycle}${r.current.label ? `：${r.current.label}` : ""}）`}
        sub={review
          ? "各 PM のレビューと、①〜⑬の成果物を読み、直すところを PM に指示します。納得したら完了して、リリースに進むか、リリースせずにサイクルを終えます。その間、エージェントの定期実行は止めています。"
          : r.state === "running"
            ? `サイクル ${r.cycle} を進めています（全体 ${r.progress.total}%）。①〜⑬の全工程が100%になると、レビューに入ります（⑭リリースはサイクルの外）。`
            : r.state === "done" ? `サイクル ${r.cycle} は終わりました。次のサイクルの戦略を決めて始めます。` : `いまは${r.state_label}です。`}
        actions={!review ? <StartReviewButton pid={id} complete={r.progress.complete} /> : undefined}
      />
      <AutoRefresh active={busy} ms={4000} />
      <div className="grid gap-6 px-8 py-6 xl:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="hidden xl:block" aria-label="工程の目次">
          <div className="sticky top-4 space-y-3 text-[12.5px]">
            {phases.map((ph) => (
              <div key={ph}>
                <div className="mb-1 text-[11px] font-semibold text-zinc-400">{ph} {PHASE[ph]}</div>
                {r.deliverables.filter((d) => d.phase === ph).map((d) => (
                  <a key={d.id} href={`#${d.id}`} className="flex items-center gap-2 rounded px-1.5 py-0.5 hover:bg-zinc-100">
                    <span className="min-w-0 flex-1 truncate">{d.no}{d.name}</span>
                    <span className={`tabular-nums text-[11px] ${d.pct >= 100 ? "text-emerald-600" : "text-amber-600"}`}>{d.pct}%</span>
                  </a>
                ))}
              </div>
            ))}
          </div>
        </nav>
        <div className="min-w-0 space-y-6">
          <section className="card p-5" aria-label="このサイクル">
            <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-zinc-600">
              <span className="font-semibold text-zinc-900">サイクル {r.cycle}{r.current.label && `：${r.current.label}`}</span>
              <span>開始 {when(r.current.started_at)}</span>
              {r.current.review_at && <span>レビュー開始 {when(r.current.review_at)}</span>}
              <span>全体 {r.progress.total}%</span>
            </div>
            {r.current.purpose && <p className="mt-2 whitespace-pre-wrap text-[12.5px] text-zinc-600"><span className="font-semibold text-zinc-800">位置付け：</span>{r.current.purpose}</p>}
            {r.current.strategy && <p className="mt-2 whitespace-pre-wrap text-[13px]"><span className="font-semibold">このサイクルの戦略：</span>{r.current.strategy}</p>}
            {Object.entries(r.current.directives).map(([k, v]) => <p key={k} className="mt-1 whitespace-pre-wrap text-[12.5px] text-zinc-600"><span className="font-medium">{PM_NAME[k]}への追加指示：</span>{v}</p>)}
          </section>
          <CyclePlanEditor key={JSON.stringify(r.plan)} pid={id} plan={r.plan} current={r.cycle} example={r.example} planned={r.planned} readOnly={viewer} />
          {RELEASE_STATES.includes(r.state) && (
            <section className="flex flex-wrap items-center gap-3 rounded-xl border border-violet-300 bg-violet-50 px-5 py-3">
              <div className="min-w-0 flex-1 text-[13px] text-violet-900">プロダクトレビューは完了しました。いまは<span className="font-semibold">{r.state_label}</span>です。</div>
              <Link href={`/p/${id}/release`} className="btn-primary">リリースを開く</Link>
            </section>
          )}
          {rounds.length > 0 && <ReviewRounds pid={id} rounds={rounds} issueStatus={r.current.review.issue_status ?? {}} active={review} readOnly={viewer} stageName={stageName} />}
          {r.state === "done" && <NextCycleForm pid={id} next={r.cycle + 1} planned={r.planned} position={r.plan[r.cycle] ?? null} />}
          {r.deliverables.map((d) => (
            <section key={d.id} id={d.id} className="card scroll-mt-4 overflow-hidden" aria-label={`${d.no}${d.name}の成果物`}>
              <header className="flex flex-wrap items-center gap-2 border-b border-zinc-100 bg-zinc-50/70 px-5 py-3">
                <h2 className="text-[15px] font-semibold"><span className="text-zinc-400">{d.no}</span>{d.name}</h2>
                <StatusBadge status={d.status} enabled />
                <span className={`rounded px-1.5 text-[11px] font-medium tabular-nums ${d.pct >= 100 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{d.pct}%</span>
                <span className="text-[11px] text-zinc-400">{d.version ? `最新版 v${d.version}` : "版なし"}</span>
                <Link href={`/p/${id}/s/${d.id}`} className="ml-auto text-[12px] text-brand-700 hover:underline">工程を開く</Link>
              </header>
              <div className="space-y-3 px-5 py-4">
                {d.goal?.goal && (
                  <p className="flex gap-1.5 rounded-lg bg-brand-50/60 px-3 py-2 text-[12.5px] text-brand-900"><Target size={14} className="mt-0.5 shrink-0" />
                    <span><span className="font-semibold">サイクル {d.goal.cycle} の目標：</span>{d.goal.goal}{d.goal.done_when ? `（完了の条件：${d.goal.done_when}）` : ""}</span></p>
                )}
                {d.missing.length > 0 && <p className="text-[12px] text-rose-600">必須が空：{d.missing.join("、")}</p>}
                {d.proto && <ProtoPreview pid={id} html={d.proto} />}
                <div className="prose-md max-h-[70vh] overflow-y-auto"><Md>{d.markdown}</Md></div>
              </div>
            </section>
          ))}
          {r.past.length > 0 && (
            <section className="card p-5" aria-label="これまでのサイクル">
              <h2 className="mb-2 text-[14px] font-semibold">これまでのサイクル</h2>
              <ol className="space-y-3 text-[12.5px]">
                {r.past.map((c) => (
                  <li key={c.number} className="border-l-2 border-zinc-200 pl-3">
                    <div className="font-medium">サイクル {c.number}{c.label && `：${c.label}`}<span className="ml-2 text-[11px] font-normal text-zinc-400">{when(c.started_at)} 〜 {when(c.ended_at)}</span></div>
                    {c.strategy && <p className="whitespace-pre-wrap text-zinc-700">戦略：{c.strategy}</p>}
                    {c.review_notes && <p className="whitespace-pre-wrap text-zinc-500">レビューの所見：{c.review_notes}</p>}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
