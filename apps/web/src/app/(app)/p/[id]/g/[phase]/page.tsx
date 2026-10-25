import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { agent, AgentError, type Overview } from "@/lib/agent";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";

type Props = { params: Promise<{ id: string; phase: string }>; searchParams: Promise<{ error?: string }> };
const DECISION = { proceed: "進む", back: "戻る", stop: "やめる" } as Record<string, string>;

export default async function GatePage({ params, searchParams }: Props) {
  const { id, phase } = await params;
  const sp = await searchParams;
  const ov = await agent<Overview>(`/products/${id}`);
  const ph = ov.phases.find((p) => p.id === phase);
  if (!ph || !ph.gate) redirect(`/p/${id}`);
  const stages = ov.stages.filter((s) => ph.stages.includes(s.id));
  const here = `/p/${id}/g/${phase}`;

  async function review(formData: FormData) {
    "use server";
    try {
      await agent(`/products/${id}/phases/${phase}/review`, {
        method: "POST",
        body: {
          decision: String(formData.get("decision")),
          reason: String(formData.get("reason") ?? ""),
          back_stage: formData.get("back_stage") ? String(formData.get("back_stage")) : null,
        },
      });
    } catch (e) {
      if (e instanceof AgentError) redirect(`${here}?error=${encodeURIComponent(e.message)}`);
      throw e;
    }
    revalidatePath(`/p/${id}`, "layout");
    redirect(here);
  }

  return (
    <>
      <PageHeader crumbs={<span>振り返り</span>} title={<>{ph.gate}<span className="text-zinc-400">・</span>{ph.gate_question}</>}
        sub={`${ph.id} ${ph.name} の区切りで、ここまでの判断を記録します。進行のロックではないので、いつでも記録できます。`} />
      <div className="max-w-3xl space-y-5 px-8 py-6">
        {sp.error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{sp.error}</div>}
        <section className="card divide-y divide-zinc-100">
          {stages.map((s) => (
            <Link key={s.id} href={`/p/${id}/s/${s.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50">
              <span className="w-5 text-zinc-400">{s.no}</span>
              <span className="font-medium">{s.name}</span>
              <span className="text-[13px] text-zinc-500">{s.framework}</span>
              <span className="ml-auto"><StatusBadge status={s.status} enabled={s.enabled} /></span>
            </Link>
          ))}
        </section>
        {!ph.complete && <p className="text-[13px] text-amber-700">使用中のステージのうち {ph.active - ph.done} 件がまだ一度も更新されていません。</p>}
        {ph.review && (
          <div className="card p-4 text-[13px]">
            <div className="section-title mb-1">直近の記録</div>
            <span className="font-medium">{DECISION[ph.review.decision]}</span>
            <span className="text-zinc-500">（{ph.review.actor}・{new Date(ph.review.at).toLocaleString("ja-JP")}）</span>
            {ph.review.reason && <p className="mt-1 text-zinc-600">{ph.review.reason}</p>}
          </div>
        )}
        <form action={review} className="card space-y-4 p-5">
          <div>
            <label className="label" htmlFor="reason">判断の理由</label>
            <textarea id="reason" name="reason" rows={3} className="input" placeholder="戻る・やめるでは必須" />
          </div>
          <div>
            <label className="label" htmlFor="back_stage">戻る場合の戻り先</label>
            <select id="back_stage" name="back_stage" className="input">
              {stages.map((s) => <option key={s.id} value={s.id}>{s.no} {s.name}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            <button name="decision" value="proceed" className="btn-primary">進む</button>
            <button name="decision" value="back" className="btn-secondary">戻る</button>
            <button name="decision" value="stop" className="btn-danger">やめる（撤退条件に照らして）</button>
          </div>
        </form>
      </div>
    </>
  );
}
