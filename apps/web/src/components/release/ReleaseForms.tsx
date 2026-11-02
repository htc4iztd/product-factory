"use client";
import { useState, useTransition } from "react";
import { CheckCircle2, KeyRound, Loader2, PencilLine, Rocket, Save, XCircle } from "lucide-react";
import type { ReleaseTarget } from "@/lib/agent";
import { approveRelease, finishManualRelease, requestReleaseChanges, saveReleaseSecret, saveReleaseTarget } from "@/app/(app)/p/[id]/cycle-actions";

// リリースの接続先：GitHub Actions・Webhook・手動
export function TargetForm({ pid, target, kinds, repo, readOnly }: { pid: string; target: ReleaseTarget; kinds: Record<string, string>; repo: string | null; readOnly: boolean }) {
  const [f, setF] = useState({ kind: target.kind ?? "", repo: target.repo ?? repo ?? "", workflow: target.workflow ?? "release.yml", ref: target.ref ?? "main", url: target.url ?? "", pass_plan: !!target.pass_plan, note: target.note ?? "" });
  const [secret, setSecret] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  return (
    <section className="card space-y-3 p-5" aria-label="リリースの接続先">
      <div>
        <h2 className="text-[15px] font-semibold">リリースの接続先</h2>
        <p className="text-[12px] text-zinc-500">リリースエージェントは、ここに決めた仕組みでデプロイ・設定を行います（このファクトリーがクラウドの API を直接叩くことはしません）。いま：{target.kind_label}</p>
      </div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="接続先の種類">
        {Object.entries(kinds).map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={f.kind === k} disabled={readOnly} onClick={() => set("kind", k)}
            className={`rounded-full border px-3 py-1 text-[12.5px] ${f.kind === k ? "border-brand-500 bg-brand-50 text-brand-800" : "border-zinc-200 text-zinc-600"}`}>{label}</button>
        ))}
      </div>
      {f.kind === "github_actions" && (
        <div className="grid gap-2 md:grid-cols-3">
          <label className="block"><span className="label">リポジトリ（owner/name）</span><input className="input" value={f.repo} disabled={readOnly} aria-label="リポジトリ" onChange={(e) => set("repo", e.target.value)} /></label>
          <label className="block"><span className="label">ワークフロー（.github/workflows のファイル名）</span><input className="input" value={f.workflow} disabled={readOnly} aria-label="ワークフロー" onChange={(e) => set("workflow", e.target.value)} /></label>
          <label className="block"><span className="label">ブランチ</span><input className="input" value={f.ref} disabled={readOnly} aria-label="ブランチ" onChange={(e) => set("ref", e.target.value)} /></label>
          <label className="flex items-center gap-1.5 text-[12px] text-zinc-600 md:col-span-3"><input type="checkbox" checked={f.pass_plan} disabled={readOnly} onChange={(e) => set("pass_plan", e.target.checked)} />
            リリースの定義をワークフローに渡す（workflow_dispatch の inputs に pf_cycle と pf_plan を定義しておくこと）</label>
          <p className="text-[11.5px] text-zinc-500 md:col-span-3">GitHub のトークン（設定 → GitHub）に Actions を起動する権限が要ります。</p>
        </div>
      )}
      {f.kind === "webhook" && (
        <div className="space-y-2">
          <label className="block"><span className="label">Webhook の URL（https・外部のアドレスだけ）</span><input className="input" value={f.url} disabled={readOnly} aria-label="Webhook の URL" placeholder="https://cd.example.com/hooks/release" onChange={(e) => set("url", e.target.value)} /></label>
          <div className="flex items-end gap-2">
            <label className="block flex-1"><span className="label flex items-center gap-1"><KeyRound size={12} />署名の鍵（任意。x-pf-signature に HMAC-SHA256 を付ける）{target.has_secret ? "・設定済み" : ""}</span>
              <input type="password" className="input" value={secret} disabled={readOnly} aria-label="署名の鍵" onChange={(e) => setSecret(e.target.value)} placeholder={target.has_secret ? "変えるときだけ入力" : ""} /></label>
            <button className="btn-secondary btn-sm mb-0.5" disabled={readOnly || !secret || pending} onClick={() => start(async () => { const r = await saveReleaseSecret(pid, secret); setMsg(r.error ?? "鍵を保存しました"); setSecret(""); })}>鍵を保存</button>
          </div>
        </div>
      )}
      {f.kind === "manual" && <p className="text-[12px] text-zinc-600">リリースエージェントの手順書のとおりに人が作業し、終わったらこの画面で「リリースを完了にする」を押します。</p>}
      {f.kind && <label className="block"><span className="label">リリースエージェントへのメモ（環境の事情など・任意）</span><textarea className="input" rows={2} value={f.note} disabled={readOnly} aria-label="接続先のメモ" onChange={(e) => set("note", e.target.value)} /></label>}
      {!readOnly && (
        <div className="flex items-center gap-2">
          <button className="btn-primary btn-sm" disabled={!f.kind || pending} onClick={() => start(async () => { const r = await saveReleaseTarget(pid, f); setMsg(r.error ?? "保存しました"); })}><Save size={12} />接続先を保存</button>
          {msg && <span className="text-[12px] text-zinc-600" role="status">{msg}</span>}
        </div>
      )}
    </section>
  );
}

// リリース前レビュー：PdM が承認するか、直させる
export function PrereleasePanel({ pid, hasTarget }: { pid: string; hasTarget: boolean }) {
  const [feedback, setFeedback] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2 rounded-lg border border-brand-200 bg-brand-50/30 p-4" aria-label="リリース前レビュー">
      <h3 className="text-[13.5px] font-semibold">リリース前レビュー（PdM）</h3>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary" disabled={pending || !hasTarget} onClick={() => { if (confirm("この定義でリリースしますか？接続先でデプロイ・設定を行います。")) start(async () => { const r = await approveRelease(pid); setErr(r.error ?? null); }); }}>
          <Rocket size={14} />リリースを承認する</button>
        {!hasTarget && <span className="text-[12px] text-amber-700">先に接続先を決めてください</span>}
        {pending && <Loader2 size={14} className="animate-spin text-zinc-400" />}
      </div>
      <label className="block"><span className="label">直させるところ（リリースエージェントがもう一度定義します）</span>
        <textarea className="input" rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)} aria-label="リリースの定義を直させるところ" /></label>
      <button className="btn-secondary btn-sm" disabled={pending || !feedback.trim()} onClick={() => start(async () => { const r = await requestReleaseChanges(pid, feedback); setErr(r.error ?? null); if (!r.error) setFeedback(""); })}><PencilLine size={12} />定義を直させる</button>
      {err && <p className="text-[12px] text-rose-600">{err}</p>}
    </div>
  );
}

// 手動のリリース：作業が終わったら完了にする
export function ManualPanel({ pid }: { pid: string }) {
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const go = (ok: boolean) => start(async () => { const r = await finishManualRelease(pid, ok, note); setErr(r.error ?? null); });
  return (
    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-4" aria-label="手動のリリース">
      <h3 className="text-[13.5px] font-semibold">手動のリリース</h3>
      <p className="text-[12px] text-zinc-600">下の手順書のとおりに作業してください。終わったら結果を残します。</p>
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} aria-label="作業のメモ" placeholder="作業のメモ（どこに出したか・気づいたこと）" />
      <div className="flex gap-2">
        <button className="btn-primary btn-sm" disabled={pending} onClick={() => go(true)}><CheckCircle2 size={12} />リリースを完了にする</button>
        <button className="btn-secondary btn-sm text-rose-600" disabled={pending} onClick={() => go(false)}><XCircle size={12} />失敗した</button>
      </div>
      {err && <p className="text-[12px] text-rose-600">{err}</p>}
    </div>
  );
}
