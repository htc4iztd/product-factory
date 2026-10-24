import { agent, type Overview } from "@/lib/agent";
import { NavLink } from "@/components/NavLink";
import { StatusChip } from "@/components/StatusChip";

// ナビゲーションバーで工程ごとの画面を切り替える（設計書 7章）
const GROUPS: { title: string; phases: string[] }[] = [
  { title: "事業", phases: ["P1", "P2"] },
  { title: "要求・設計", phases: ["P3"] },
  { title: "構築", phases: ["P4"] },
  { title: "リリース", phases: ["P5"] },
];
const LOOPS = ["L1 構成管理", "L2 継続監視", "L3 LLMOps/AgentOps", "L4 KPI・財務管理", "L5 市場・顧客の観測"];

export default async function ProductLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ov = await agent<Overview>(`/products/${id}`);
  const stages = Object.fromEntries(ov.stages.map((s) => [s.id, s]));
  const phases = Object.fromEntries(ov.phases.map((p) => [p.id, p]));
  return (
    <div className="flex">
      <nav className="min-h-[calc(100vh-3rem)] w-64 shrink-0 space-y-4 bg-pale p-3">
        <NavLink href={`/p/${id}`}>
          <span className="font-bold text-deep">{ov.product.name}</span>
        </NavLink>
        {GROUPS.map((g) => (
          <div key={g.title}>
            <div className="mb-1 px-2 text-xs font-bold text-muted">{g.title}</div>
            {g.phases.flatMap((pid) => {
              const ph = phases[pid];
              const items = ph.stages.map((sid) => (
                <NavLink key={sid} href={`/p/${id}/s/${sid}`} disabled={!ph.unlocked}>
                  <span className="flex items-center justify-between gap-2">
                    <span>{stages[sid].no} {stages[sid].name}</span>
                    <StatusChip status={stages[sid].status} />
                  </span>
                </NavLink>
              ));
              if (ph.gate) {
                items.push(
                  <NavLink key={ph.gate} href={`/p/${id}/g/${pid}`} disabled={!ph.unlocked}>
                    <span className="flex items-center justify-between gap-2">
                      <span>◆ {ph.gate} 審査</span>
                      <span className="text-xs text-muted">
                        {ph.review ? { proceed: "進む", back: "戻る", stop: "やめる" }[ph.review.decision] : ph.complete ? "審査待ち" : ""}
                      </span>
                    </span>
                  </NavLink>,
                );
              }
              return items;
            })}
          </div>
        ))}
        <div>
          <div className="mb-1 px-2 text-xs font-bold text-muted">運用ループ（R2で稼働）</div>
          {LOOPS.map((l) => <NavLink key={l} href="#" disabled>{l}</NavLink>)}
        </div>
        <div>
          <div className="mb-1 px-2 text-xs font-bold text-muted">共通</div>
          <NavLink href={`/p/${id}/audit`}>監査ログ</NavLink>
          <NavLink href="#" disabled>トレース（R2）</NavLink>
          <NavLink href="#" disabled>変更要求（R2）</NavLink>
        </div>
      </nav>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
