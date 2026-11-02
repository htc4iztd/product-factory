"use client";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, ClipboardList, Loader2, Rocket, RotateCcw, Send, SkipForward, Wrench } from "lucide-react";
import type { PmFinding, ReviewRound } from "@/lib/agent";
import { reviewAgain, reviewComplete, reviewFix } from "@/app/(app)/p/[id]/cycle-actions";
import { Avatar } from "@/components/rail/Avatar";

const PM: [string, string][] = [["pm_biz", "事業PM"], ["pm_design", "設計PM"], ["pm_impl", "実装PM"]];
const STATUS: Record<ReviewRound["status"], { label: string; tone: string }> = {
  reviewing: { label: "PM がレビューしています…", tone: "bg-sky-100 text-sky-800" },
  ready: { label: "PM のレビューが出ました", tone: "bg-amber-100 text-amber-800" },
  fixing: { label: "担当が修正しています", tone: "bg-violet-100 text-violet-800" },
  fixed: { label: "修正が終わりました", tone: "bg-emerald-100 text-emerald-800" },
};
const SEV: Record<string, string> = { high: "bg-rose-100 text-rose-700", medium: "bg-amber-100 text-amber-800", low: "bg-zinc-100 text-zinc-600" };
const SEV_JA: Record<string, string> = { high: "重い", medium: "直すべき", low: "軽い" };
const ISSUE_DONE = ["resolved", "closed", "rejected"];

// プロダクトレビューの回：PM のレビュー（指摘）→ PdM が修正を指示 → 担当が直す → もう一度 PM がレビュー …
export function ReviewRounds({ pid, rounds, issueStatus, active, readOnly, stageName }: {
  pid: string; rounds: ReviewRound[]; issueStatus: Record<string, string>; active: boolean; readOnly: boolean; stageName: Record<string, string>;
}) {
  const latest = rounds[rounds.length - 1];
  const [open, setOpen] = useState<number>(latest?.n ?? 0);
  useEffect(() => { if (latest) setOpen(latest.n); }, [latest?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!latest) return null;
  return (
    <section className="card overflow-hidden" aria-label="PM のレビュー">
      <header className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-5 py-3">
        <ClipboardList size={16} className="text-brand-600" />
        <h2 className="text-[15px] font-semibold">PM のレビュー</h2>
        <span className="text-[12px] text-zinc-500">各 PM が自分の領域の成果物をレビューし、PdM が修正を指示します。直したらもう一度レビューして、ブラッシュアップを重ねます。</span>
        <nav className="ml-auto flex gap-1" aria-label="レビューの回">
          {rounds.map((r) => (
            <button key={r.n} onClick={() => setOpen(r.n)} aria-pressed={open === r.n}
              className={`rounded-full border px-2.5 py-0.5 text-[12px] ${open === r.n ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 text-zinc-600"}`}>第 {r.n} 回</button>
          ))}
        </nav>
      </header>
      {rounds.filter((r) => r.n === open).map((r) => (
        <div key={r.n} className="space-y-4 px-5 py-4">
          <div className="flex items-center gap-2 text-[12.5px]">
            <span className={`rounded px-2 py-0.5 text-[11.5px] font-medium ${STATUS[r.status].tone}`}>
              {(r.status === "reviewing" || r.status === "fixing") && <Loader2 size={11} className="mr-1 inline animate-spin" />}{STATUS[r.status].label}
            </span>
            {r.job_id && <Link href={`/jobs/${r.job_id}`} className="text-[11.5px] text-zinc-500 hover:underline">ジョブを見る</Link>}
          </div>
          {r.status !== "reviewing" && (
            <div className="grid gap-3 lg:grid-cols-3">
              {PM.map(([k, name]) => {
                const v = r.pm[k];
                if (!v) return null;
                return (
                  <article key={k} className="rounded-lg border border-zinc-200 p-3" aria-label={`${name}のレビュー`}>
                    <div className="mb-1.5 flex items-center gap-2">
                      <Avatar k={k} size={24} /><span className="text-[13px] font-semibold">{name}</span>
                      <span className={`ml-auto rounded px-1.5 text-[11px] font-medium ${v.verdict === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
                        {v.verdict === "ok" ? "問題なし" : `指摘 ${v.findings.length} 件`}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-[12.5px] text-zinc-700">{v.summary}</p>
                    {v.findings.length > 0 && <Findings items={v.findings} pid={pid} stageName={stageName} />}
                  </article>
                );
              })}
            </div>
          )}
          {r.fixes.length > 0 && (
            <div className="rounded-lg bg-zinc-50 p-3 text-[12.5px]" aria-label="修正の指示">
              <div className="mb-1 flex items-center gap-1.5 font-semibold"><Wrench size={13} />PdM の修正の指示{r.notes && <span className="font-normal text-zinc-500">（{r.notes}）</span>}</div>
              <ul className="space-y-1">
                {r.fixes.map((f, i) => (
                  <li key={i}>
                    <span className="font-medium">{PM.find(([k]) => k === f.pm)?.[1]}：</span>{f.text}
                    <span className="ml-2 inline-flex flex-wrap gap-1">
                      {f.issues.map((n) => (
                        <Link key={n} href={`/p/${pid}/issues/${n}`} className={`rounded px-1.5 font-mono text-[11px] ${ISSUE_DONE.includes(issueStatus[String(n)]) ? "bg-emerald-100 text-emerald-800" : "bg-white text-zinc-600 ring-1 ring-zinc-200"}`}>
                          #{n}{ISSUE_DONE.includes(issueStatus[String(n)]) ? " 済" : ""}
                        </Link>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {active && !readOnly && r.n === latest.n && (r.status === "ready" || r.status === "fixed") && <PdmPanel pid={pid} round={r} />}
        </div>
      ))}
    </section>
  );
}

function Findings({ items, pid, stageName }: { items: PmFinding[]; pid: string; stageName: Record<string, string> }) {
  return (
    <ul className="mt-2 space-y-1.5">
      {items.map((f, i) => (
        <li key={i} className="rounded border border-zinc-100 bg-white p-2 text-[12px]">
          <div className="flex items-center gap-1.5">
            <span className={`rounded px-1 text-[10.5px] font-semibold ${SEV[f.severity] ?? SEV.low}`}>{SEV_JA[f.severity] ?? f.severity}</span>
            <Link href={`/p/${pid}/review#${f.stage}`} className="text-[11.5px] font-medium text-brand-700 hover:underline">{stageName[f.stage] ?? f.stage}</Link>
          </div>
          <p className="mt-0.5 text-zinc-800">{f.text}</p>
          {f.fix && <p className="mt-0.5 text-zinc-500">直し方：{f.fix}</p>}
        </li>
      ))}
    </ul>
  );
}

// PdM：PM に修正を指示する・もう一度レビューさせる・完了する
function PdmPanel({ pid, round }: { pid: string; round: ReviewRound }) {
  const [notes, setNotes] = useState("");
  const [dir, setDir] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string }>) => start(async () => { const r = await fn(); setErr(r.error ?? null); });
  const fromFindings = (k: string) => (round.pm[k]?.findings ?? []).map((f) => `・${f.text}${f.fix ? `（${f.fix}）` : ""}`).join("\n");
  const any = Object.values(dir).some((v) => v.trim());
  return (
    <div className="space-y-3 rounded-lg border border-brand-200 bg-brand-50/30 p-4" aria-label="PdM の判断">
      <h3 className="text-[13.5px] font-semibold">PdM の判断</h3>
      <div className="grid gap-3 lg:grid-cols-3">
        {PM.map(([k, name]) => (
          <div key={k}>
            <div className="label flex items-center justify-between">{name}への修正の指示（任意）
              {(round.pm[k]?.findings.length ?? 0) > 0 && <button type="button" className="text-[11px] font-normal text-brand-700 hover:underline" onClick={() => setDir((d) => ({ ...d, [k]: fromFindings(k) }))}>指摘をそのまま指示にする</button>}
            </div>
            <textarea className="input text-[12.5px]" rows={4} value={dir[k] ?? ""} aria-label={`${name}への修正の指示`} onChange={(e) => setDir((d) => ({ ...d, [k]: e.target.value }))} />
          </div>
        ))}
      </div>
      <label className="block"><span className="label">全体への所見（任意）</span>
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="全体への所見" /></label>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary" disabled={pending || !any} onClick={() => run(() => reviewFix(pid, notes, dir))}><Send size={14} />PM に修正を指示する</button>
        {round.status === "fixed" && <button className="btn-secondary" disabled={pending} onClick={() => run(() => reviewAgain(pid))}><RotateCcw size={14} />もう一度 PM にレビューさせる</button>}
        <span className="mx-1 h-6 w-px bg-zinc-200" />
        <button className="btn-secondary" disabled={pending} onClick={() => { if (confirm("プロダクトレビューを完了して、リリースの準備（オンボーディング）に進みますか？")) run(() => reviewComplete(pid, "release")); }}>
          <Rocket size={14} />レビューを完了してリリースに進む</button>
        <button className="btn-ghost" disabled={pending} onClick={() => { if (confirm("リリースせずに、このサイクルを終えますか？")) run(() => reviewComplete(pid, "skip")); }}>
          <SkipForward size={14} />リリースせずにサイクルを終える</button>
        {pending && <Loader2 size={14} className="animate-spin text-zinc-400" />}
        {err && <span className="text-[12px] text-rose-600">{err}</span>}
      </div>
      <p className="flex items-center gap-1 text-[11.5px] text-zinc-500"><CheckCircle2 size={12} />修正を指示すると、各 PM が担当に Issue を出し、担当がすぐ直します。直り終わったら知らせます。</p>
    </div>
  );
}
