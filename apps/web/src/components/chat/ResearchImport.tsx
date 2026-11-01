"use client";
import { useEffect, useState } from "react";
import { Library, X } from "lucide-react";
import { researchChoices } from "@/app/(app)/research/actions";

type Choice = Awaited<ReturnType<typeof researchChoices>>[number];

// リサーチライブラリの論点のまとめとファクトを、根拠つきの案を頼む発言として送る
export function ResearchImport({ busy, onSend, onClose }: { busy: boolean; onSend: (n: number, issue: string, label: string) => void; onClose: () => void }) {
  const [libs, setLibs] = useState<Choice[] | null>(null);
  const [n, setN] = useState(0);
  const [issue, setIssue] = useState("");
  useEffect(() => {
    researchChoices().then((xs) => { setLibs(xs); if (xs[0]) setN(xs[0].number); }).catch(() => setLibs([]));
  }, []);
  const cur = libs?.find((x) => x.number === n);
  return (
    <div className="mb-2 space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2.5">
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-700">
        <Library size={13} />リサーチから取り込む
        <button onClick={onClose} className="btn-ghost btn-sm ml-auto h-6 w-6 p-0" aria-label="閉じる"><X size={12} /></button>
      </div>
      {libs === null ? <p className="text-[11px] text-zinc-400">読み込み中…</p> : libs.length === 0 ? (
        <p className="text-[11px] text-zinc-500">リサーチライブラリがありません。<a href="/research" className="text-brand-700 hover:underline">リサーチライブラリ</a>で作ってください。</p>
      ) : (
        <div className="flex gap-1.5">
          <select value={n} onChange={(e) => { setN(Number(e.target.value)); setIssue(""); }} className="input h-8 min-w-0 flex-1 py-0 text-[12px]" aria-label="ライブラリ">
            {libs.map((x) => <option key={x.number} value={x.number}>{x.key} {x.name}（ファクト {x.facts}）</option>)}
          </select>
          <select value={issue} onChange={(e) => setIssue(e.target.value)} className="input h-8 w-32 py-0 text-[12px]" aria-label="論点">
            <option value="">論点：すべて</option>
            {cur?.issues.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <button disabled={busy || !cur} onClick={() => cur && onSend(cur.number, issue, `${cur.key}「${cur.name}」${issue ? `の論点「${issue}」` : ""}を取り込む`)} className="btn-primary btn-sm">送る</button>
        </div>
      )}
    </div>
  );
}
