import Link from "next/link";
import { agent, type Overview } from "@/lib/agent";
import { StatusChip } from "@/components/StatusChip";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ov = await agent<Overview>(`/products/${id}`);
  const stages = Object.fromEntries(ov.stages.map((s) => [s.id, s]));
  const waiting = ov.stages.filter((s) => s.pending_kind);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-deep">{ov.product.name}</h1>
        <p className="text-muted">{ov.product.idea}</p>
        {ov.product.status === "stopped" && <p className="mt-2 font-bold text-amber">このプロダクトは中止されました</p>}
      </div>
      <section className="card">
        <h2 className="mb-2 font-bold text-deep">自分の入力待ち</h2>
        {waiting.length === 0 ? <p className="text-sm text-muted">ありません</p> : (
          <ul className="space-y-1 text-sm">
            {waiting.map((s) => (
              <li key={s.id}>
                <Link href={`/p/${id}/s/${s.id}`} className="text-teal underline">
                  {s.no} {s.name}：{s.pending_kind === "clarify" ? "確認質問" : "承認"}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="grid gap-4 md:grid-cols-2">
        {ov.phases.map((ph) => (
          <div key={ph.id} className={`card ${ph.unlocked ? "" : "opacity-50"}`}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-bold text-deep">{ph.id} {ph.name}</h3>
              {ph.gate && <span className="text-xs text-muted">◆ {ph.gate} {ph.gate_question}</span>}
            </div>
            <ul className="space-y-1 text-sm">
              {ph.stages.map((sid) => (
                <li key={sid} className="flex justify-between">
                  <span>{stages[sid].no} {stages[sid].name}</span>
                  <StatusChip status={stages[sid].status} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
