"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowDownToLine, Boxes } from "lucide-react";
import type { VariantStage } from "@/lib/agent";
import { adoptPreProductStage } from "@/app/(app)/p/[id]/autodev-actions";

// 案（プリプロダクト）のタブを見ているときの帯：どの案か・考え方と、この工程だけ本線に取り込むボタン
export function PatternStageBar({ pid, sid, v, stageName, canEdit }: { pid: string; sid: string; v: VariantStage; stageName: string; canEdit: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="card space-y-2 border-violet-200 bg-violet-50/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip border-violet-200 font-mono text-violet-800">{v.key}</span>
        <span className="text-[14px] font-semibold">{v.title}</span>
        <span className="text-[12px] text-zinc-500">の {stageName}（読み取り専用）</span>
        <div className="ml-auto flex items-center gap-2">
          <Link href={`/p/${pid}/preproducts/${v.number}`} className="btn-secondary btn-sm"><Boxes size={13} />この案の全体と試作</Link>
          {canEdit && (
            <button disabled={pending} className="btn-primary btn-sm"
              onClick={() => { if (confirm(`${v.key} の${stageName}を本線の下書きに入れますか？（本線の同じ項目は上書きされます）`)) start(async () => { const r = await adoptPreProductStage(pid, v.number, sid); if (r?.error) setError(r.error); }); }}>
              <ArrowDownToLine size={13} />{pending ? "取り込み中…" : "この工程だけ本線に取り込む"}
            </button>
          )}
        </div>
      </div>
      <p className="text-[12px] leading-5 text-zinc-700">{v.concept}</p>
      {v.assumptions.length > 0 && <p className="text-[11px] text-zinc-500">前提：{v.assumptions.join("／")}</p>}
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}
