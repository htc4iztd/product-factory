import Link from "next/link";
import { AlertTriangle, Cloud, ListChecks, RotateCcw, Settings2, Undo2 } from "lucide-react";
import { agent, type Overview, type ReleasePlan, type ReleaseView } from "@/lib/agent";
import { auth } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { AutoRefresh } from "@/components/autodev/AutoRefresh";
import { ManualPanel, PrereleasePanel, TargetForm } from "@/components/release/ReleaseForms";

const when = (t: string | null | undefined) => (t ? new Date(t).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const ENV_JA: Record<string, string> = { cloud: "クラウド", onprem: "オンプレミス", hybrid: "ハイブリッド", saas: "SaaS" };
const METHOD_JA: Record<string, string> = { "all-at-once": "一度に切り替え", rolling: "ローリング", "blue-green": "ブルーグリーン", canary: "カナリア", manual: "手動" };
const STATUS_JA: Record<string, string> = { defining: "リリースエージェントが定義しています…", review: "リリース前レビュー待ち", releasing: "リリースしています…", waiting_manual: "手動の作業待ち", released: "リリースしました", failed: "リリースに失敗しました" };

// リリース（サイクルの外）：プロダクトレビューのあと、リリースエージェントがリリース先の環境と方式を定義し（オンボーディング）、
// PdM がリリース前レビューで承認すると、接続先でデプロイ・設定を行う
export default async function ReleasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [v, ov, session] = await Promise.all([agent<ReleaseView>(`/products/${id}/release`), agent<Overview>(`/products/${id}`), auth()]);
  const viewer = session?.user?.role === "VIEWER";
  const rel = v.current.release ?? {};
  const busy = ["onboarding", "releasing"].includes(v.state) && rel.status !== "waiting_manual";
  return (
    <>
      <AutoRefresh active={busy} ms={4000} />
      <PageHeader
        crumbs={<><Link href={`/p/${id}`} className="hover:text-zinc-700">ダッシュボード</Link><span>/</span><span>リリース</span></>}
        title={`リリース（サイクル ${v.cycle}${v.current.label ? `：${v.current.label}` : ""}）`}
        sub="⑭リリースはサイクルの外です。プロダクトレビューを完了してリリースに進むと、リリースエージェントがリリース先の環境と方式を定義し（オンボーディング）、PdM がリリース前レビューで承認すると、接続先でデプロイ・設定を行います。"
      />
      <div className="space-y-6 px-8 py-6">
        <section className="card flex flex-wrap items-center gap-3 p-5" aria-label="いまの状態">
          <span className="rounded-full bg-zinc-900 px-2.5 py-0.5 text-[12px] font-medium text-white">{v.state_label}</span>
          {rel.status && <span className="text-[13px] text-zinc-700">{STATUS_JA[rel.status] ?? rel.status}</span>}
          {rel.error && <span className="flex items-center gap-1 text-[12.5px] text-rose-600"><AlertTriangle size={13} />{rel.error}</span>}
          {v.state === "running" && <span className="text-[12.5px] text-zinc-500">サイクル実行中です。プロダクトレビューを完了すると、ここでリリースに進みます。</span>}
          {v.state === "review" && <Link href={`/p/${id}/review`} className="btn-secondary btn-sm ml-auto">プロダクトレビューを開く</Link>}
        </section>
        <TargetForm pid={id} target={v.target} kinds={v.kinds} repo={ov.product.repo} readOnly={viewer} />
        {rel.plan && (
          <section className="card space-y-4 p-5" aria-label="リリースの定義">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-semibold">リリースの定義（リリースエージェント）</h2>
              <span className="text-[11.5px] text-zinc-500">{when(rel.defined_at)}</span>
              {rel.feedback && <span className="text-[11.5px] text-zinc-500">（PdM の指摘「{rel.feedback}」を受けて直した版）</span>}
            </div>
            <Plan plan={rel.plan} />
            {v.state === "prerelease" && !viewer && <PrereleasePanel pid={id} hasTarget={!!v.target.kind} />}
            {v.state === "releasing" && rel.status === "waiting_manual" && !viewer && <ManualPanel pid={id} />}
            {rel.result && (
              <div className={`rounded-lg p-3 text-[12.5px] ${rel.result.status === "released" ? "bg-emerald-50 text-emerald-900" : rel.result.status === "failed" ? "bg-rose-50 text-rose-900" : "bg-zinc-50"}`} aria-label="リリースの結果">
                <div className="font-semibold">{STATUS_JA[rel.result.status] ?? rel.result.status}（{when(rel.result.at)}）</div>
                <div>{rel.result.detail}</div>
                <ul className="mt-1 list-disc pl-5 text-[12px]">{rel.result.log.map((l, i) => <li key={i}>{l}</li>)}</ul>
              </div>
            )}
            {(rel.history ?? []).length > 0 && (
              <details className="text-[12.5px]"><summary className="cursor-pointer text-zinc-500">前の定義（{rel.history!.length}）</summary>
                <ul className="mt-1 space-y-1">{rel.history!.map((h, i) => <li key={i} className="text-zinc-600">{when(h.at)}：{h.plan.environment.provider}・{METHOD_JA[h.plan.method.strategy] ?? h.plan.method.strategy} → 指摘「{h.feedback}」</li>)}</ul>
              </details>
            )}
          </section>
        )}
        {v.releases.length > 0 && (
          <section className="card p-5" aria-label="これまでのリリース">
            <h2 className="mb-2 text-[14px] font-semibold">これまでのリリース</h2>
            <ul className="space-y-1.5 text-[12.5px]">
              {v.releases.map((r) => (
                <li key={r.number} className="flex flex-wrap gap-2">
                  <span className="font-medium">サイクル {r.number}{r.label && `：${r.label}`}</span>
                  <span className="text-zinc-600">{STATUS_JA[r.status ?? ""] ?? r.status ?? "—"}</span>
                  {r.plan && <span className="text-zinc-500">{ENV_JA[r.plan.environment.kind] ?? r.plan.environment.kind}・{r.plan.environment.provider}・{METHOD_JA[r.plan.method.strategy] ?? r.plan.method.strategy}</span>}
                  {r.result && <span className="text-zinc-400">{when(r.result.at)}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}

function Plan({ plan }: { plan: ReleasePlan }) {
  return (
    <div className="space-y-4 text-[13px]">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-zinc-500"><Cloud size={13} />リリース先の環境</div>
          <div className="font-semibold">{ENV_JA[plan.environment.kind] ?? plan.environment.kind}・{plan.environment.provider}<span className="ml-1 font-normal text-zinc-500">{plan.environment.region}</span></div>
          <p className="mt-1 whitespace-pre-wrap text-zinc-700">{plan.environment.summary}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-zinc-500"><RotateCcw size={13} />リリース方式</div>
          <div className="font-semibold">{METHOD_JA[plan.method.strategy] ?? plan.method.strategy}</div>
          <p className="mt-1 whitespace-pre-wrap text-zinc-700">{plan.method.summary}</p>
        </div>
      </div>
      <div>
        <div className="mb-1 text-[12px] font-semibold text-zinc-500">手順</div>
        <ol className="space-y-1.5">{plan.steps.map((s, i) => <li key={i} className="flex gap-2"><span className="w-5 shrink-0 text-right font-mono text-zinc-400">{i + 1}.</span><span><span className="font-medium">{s.title}</span>　<span className="text-zinc-600">{s.detail}</span></span></li>)}</ol>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-zinc-500"><Settings2 size={13} />設定</div>
          <table className="w-full text-[12.5px]"><tbody>{plan.configs.map((c, i) => <tr key={i} className="border-t border-zinc-100"><td className="py-1 pr-2 font-mono text-[11.5px]">{c.name}</td><td className="py-1 text-zinc-600">{c.value}</td></tr>)}</tbody></table>
        </div>
        <div className="space-y-2">
          <div><div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-zinc-500"><ListChecks size={13} />リリースのあとに確かめること</div><ul className="list-disc pl-5">{plan.checks.map((c, i) => <li key={i}>{c}</li>)}</ul></div>
          <div><div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-zinc-500"><Undo2 size={13} />切り戻し</div><p className="whitespace-pre-wrap text-zinc-700">{plan.rollback}</p></div>
          {plan.risks.length > 0 && <div><div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-zinc-500"><AlertTriangle size={13} />リスク</div><ul className="list-disc pl-5 text-zinc-700">{plan.risks.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
        </div>
      </div>
    </div>
  );
}
