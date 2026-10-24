import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { agent, AgentError, type Overview } from "@/lib/agent";
import { StatusChip } from "@/components/StatusChip";

type Props = { params: Promise<{ id: string; phase: string }>; searchParams: Promise<{ error?: string }> };

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
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold text-deep">◆ {ph.gate} フェーズ審査：{ph.gate_question}</h1>
      {sp.error && <div className="rounded border border-amber bg-amber-light p-3 text-sm">{sp.error}</div>}
      <section className="card">
        <h2 className="mb-2 font-bold text-deep">{ph.id} {ph.name} のステージ</h2>
        <ul className="space-y-1 text-sm">
          {stages.map((s) => (
            <li key={s.id} className="flex justify-between">
              <a className="text-teal underline" href={`/p/${id}/s/${s.id}`}>{s.no} {s.name}</a>
              <StatusChip status={s.status} />
            </li>
          ))}
        </ul>
      </section>
      {ph.review && (
        <p className="text-sm text-muted">
          直近の審査：{{ proceed: "進む", back: "戻る", stop: "やめる" }[ph.review.decision]}（{ph.review.actor}）{ph.review.reason && `— ${ph.review.reason}`}
        </p>
      )}
      {ph.complete ? (
        <form action={review} className="card space-y-3 border-2 border-amber">
          <textarea name="reason" rows={3} className="input" placeholder="理由（戻る・やめるでは必須）" />
          <label className="block text-sm">
            戻る場合の戻り先
            <select name="back_stage" className="input mt-1">
              {stages.map((s) => <option key={s.id} value={s.id}>{s.no} {s.name}</option>)}
            </select>
          </label>
          <div className="flex gap-2">
            <button name="decision" value="proceed" className="btn-accent">進む</button>
            <button name="decision" value="back" className="btn-ghost">戻る</button>
            <button name="decision" value="stop" className="btn-ghost">やめる（撤退条件に照らして）</button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-muted">フェーズ内のステージがすべて完了すると審査できます。</p>
      )}
    </div>
  );
}
