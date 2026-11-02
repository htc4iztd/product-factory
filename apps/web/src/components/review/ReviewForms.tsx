"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, RotateCcw } from "lucide-react";
import { startNextCycle, startReview } from "@/app/(app)/p/[id]/cycle-actions";

const PMS: [string, string, string][] = [["pm_biz", "事業PM", "①〜⑤ 事業"], ["pm_design", "設計PM", "⑥〜⑪ 要求・設計"], ["pm_impl", "実装PM", "⑫〜⑭ 構築・リリース"]];

// レビューを始める（全工程が100%になる前でも、PdM が始められる）
export function StartReviewButton({ pid, complete }: { pid: string; complete: boolean }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      <button className={complete ? "btn-primary" : "btn-secondary"} disabled={pending}
        onClick={() => {
          if (!complete && !confirm("まだ100%になっていない工程があります。レビューを始めると、エージェントの定期実行を止めます。始めますか？")) return;
          start(async () => { const r = await startReview(pid); if (r.error) setErr(r.error); });
        }}><RotateCcw size={14} />{pending ? "始めています…" : "プロダクトレビューを始める"}</button>
      {err && <span className="text-[12px] text-rose-600">{err}</span>}
    </span>
  );
}

// 次のサイクルの戦略と、PM ごとの追加指示を書いて、次のサイクルを始める
export function NextCycleForm({ pid, next }: { pid: string; next: number }) {
  const router = useRouter();
  const [strategy, setStrategy] = useState("");
  const [notes, setNotes] = useState("");
  const [dir, setDir] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <section className="card space-y-3 p-5" aria-label="次のサイクル">
      <div>
        <h2 className="text-[15px] font-semibold">サイクル {next} を始める</h2>
        <p className="mt-0.5 text-[12px] text-zinc-500">
          書いた戦略に沿って、PM が工程ごとの目標と計画を決め、担当に Issue を出します。工程の進み具合は0%に戻ります（成果物は残り、そこからエンハンスします）。
        </p>
      </div>
      <label className="block"><span className="label">このサイクルのレビューの所見（任意）</span>
        <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="レビューの所見" placeholder="成果物を読んで気づいたこと・足りないこと" /></label>
      <label className="block"><span className="label">次のサイクルの戦略（必須）</span>
        <textarea className="input" rows={4} value={strategy} onChange={(e) => setStrategy(e.target.value)} aria-label="次のサイクルの戦略" placeholder="何を狙い、何を強化するか。優先すること・やらないこと" /></label>
      <div className="grid gap-3 md:grid-cols-3">
        {PMS.map(([k, name, area]) => (
          <label key={k} className="block"><span className="label">{name}への追加指示（{area}・任意）</span>
            <textarea className="input" rows={4} value={dir[k] ?? ""} aria-label={`${name}への追加指示`} onChange={(e) => setDir((d) => ({ ...d, [k]: e.target.value }))} /></label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={pending || !strategy.trim()}
          onClick={() => start(async () => {
            const r = await startNextCycle(pid, { strategy, directives: dir, notes });
            if (r.error) setErr(r.error); else router.push(`/p/${pid}`);
          })}><Play size={14} />{pending ? "始めています…" : `サイクル ${next} を始める`}</button>
        <span className="text-[12px] text-zinc-500">始めると、まず PM が計画を立て、その後で担当が動きます。</span>
        {err && <span className="text-[12px] text-rose-600">{err}</span>}
      </div>
    </section>
  );
}
