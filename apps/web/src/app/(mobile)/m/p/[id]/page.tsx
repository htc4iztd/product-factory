import { Suspense } from "react";
import { agent, STATUS_LABEL, type CycleState, type Overview } from "@/lib/agent";
import { MobileHome, Row } from "@/components/mobile/MobileHome";

const TONE: Record<string, string> = { completed: "bg-emerald-100 text-emerald-800", awaiting_approval: "bg-amber-100 text-amber-800", in_progress: "bg-sky-100 text-sky-800", revising: "bg-violet-100 text-violet-800", needs_recheck: "bg-rose-100 text-rose-700" };

// スマホのプロダクト：チャット｜承認｜進捗（サイクルの状態と、工程ごとの進み具合。押すと工程の成果物を全画面で読む）
export default async function MobileProduct({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [ov, cy] = await Promise.all([agent<Overview>(`/products/${id}`), agent<CycleState>(`/products/${id}/cycle`).catch(() => null)]);
  const pct = Object.fromEntries((cy?.progress.stages ?? []).map((s) => [s.id, s.pct]));
  const progress = (
    <div>
      {cy && (
        <div className="mb-2 rounded-xl bg-zinc-50 p-3 text-[13px]">
          <div className="font-semibold">サイクル {cy.cycle}{cy.current.label ? `：${cy.current.label}` : ""}</div>
          <div className="text-zinc-600">{cy.state_label}</div>
        </div>
      )}
      <Row href={`/p/${id}/s/s06/ui`} title="UI のプロトタイプ" sub="触って確かめる・コメントで直させる" />
      {ov.stages.filter((s) => s.enabled).map((s) => (
        <Row key={s.id} href={`/p/${id}/s/${s.id}`} title={`${s.no} ${s.name}`} sub={pct[s.id] !== undefined ? `進み具合 ${pct[s.id]}%` : undefined}
          right={<span className={`shrink-0 rounded px-1.5 text-[11px] font-medium ${TONE[s.status] ?? "bg-zinc-100 text-zinc-600"}`}>{STATUS_LABEL[s.status] ?? s.status}</span>} />
      ))}
    </div>
  );
  return <Suspense><MobileHome progressLabel="進捗" progress={progress} /></Suspense>;
}
