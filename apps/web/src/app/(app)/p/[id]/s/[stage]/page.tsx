import Link from "next/link";
import { ArrowRight, Lock } from "lucide-react";
import { agent, type StageDetail } from "@/lib/agent";
import { StatusBadge, StatusDot } from "@/components/StatusBadge";
import { Canvas } from "@/components/stage/Canvas";
import { cookies } from "next/headers";
import { AiDrawer } from "@/components/stage/AiDrawer";
import { DocEditor } from "@/components/stage/DocEditor";
import { ApprovalPanel, ClosedBanner, CommitButton, RecheckBanner } from "@/components/stage/StageActions";

type Props = { params: Promise<{ id: string; stage: string }>; searchParams: Promise<{ tab?: string; session?: string }> };

const PHASE_NAME: Record<string, string> = { P1: "探索", P2: "事業定義", P3: "要求・設計", P4: "構築", P5: "リリース" };

export default async function StagePage({ params, searchParams }: Props) {
  const { id, stage } = await params;
  const sp = await searchParams;
  const tab = sp.tab ?? "canvas";
  const st = await agent<StageDetail>(`/products/${id}/stages/${stage}${sp.session ? `?session=${encodeURIComponent(sp.session)}` : ""}`);
  const panel = (await cookies()).get("pf_ai")?.value;
  const drawer = panel === "closed" || panel === "ref" ? panel : "ai";
  const here = `/p/${id}/s/${stage}`;
  const awaiting = st.status === "awaiting_approval";
  const readOnly = !st.enabled;
  const required = st.framework.fields.filter((f) => f.required).length;
  const filled = required - st.missing.length;
  const tabs = [["canvas", "キャンバス"], ["doc", "文書"], ["history", `版の履歴（${st.versions.length}）`]];

  return (
    <div className="flex h-screen flex-col">
      <header className="shrink-0 border-b border-zinc-200 bg-white px-8 pt-4">
        <div className="mb-2 flex items-center gap-1.5 text-xs text-zinc-400">
          <Link href={`/p/${id}`} className="hover:text-zinc-700">概要</Link><span>/</span><span>{st.phase} {PHASE_NAME[st.phase]}</span>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2.5 text-xl font-semibold tracking-tight">
              <span className="text-zinc-400">{st.no}</span>{st.name}<StatusBadge status={st.status} enabled={st.enabled} />
            </h1>
            <p className="mt-1 text-[13px] text-zinc-500"><span className="font-medium text-zinc-700">{st.framework.title}</span> — {st.framework.summary}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right text-[11px] leading-4 text-zinc-400">
              <div>必須項目 <span className="tabular-nums text-zinc-700">{filled}/{required}</span></div>
              <div>{st.approved_version ? `最新版 v${st.approved_version}` : "版なし"}{st.dirty && st.approved_version > 0 ? "・未更新の変更あり" : ""}</div>
            </div>
            {st.approval_required && <span className="chip"><Lock size={11} />承認あり</span>}
            {st.enabled && !awaiting && (
              <CommitButton pid={id} sid={stage} missing={st.missing} dirty={st.dirty} approval={st.approval_required} hasVersion={st.current_version > 0} />
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <nav className="flex gap-4 text-[13px]">
            {tabs.map(([k, l]) => (
              <Link key={k} href={`${here}?tab=${k}${sp.session ? `&session=${encodeURIComponent(sp.session)}` : ""}`} className={`-mb-px border-b-2 pb-2.5 ${tab === k ? "border-zinc-900 font-medium text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-800"}`}>{l}</Link>
            ))}
          </nav>
          <div className="ml-auto flex flex-wrap items-center gap-1.5 pb-2 text-[11px] text-zinc-400">
            {st.inputs.length > 0 && <span>参照する上流</span>}
            {st.inputs.map((s) => (
              <Link key={s.id} href={`/p/${id}/s/${s.id}`} className="chip hover:border-zinc-300"><StatusDot status={s.status ?? ""} enabled={s.enabled} />{s.no} {s.name}</Link>
            ))}
            {st.downstream.length > 0 && <span className="ml-2 flex items-center gap-1"><ArrowRight size={11} />下流 {st.downstream.length}</span>}
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="min-w-0 flex-1 overflow-y-auto">
          <div className="space-y-4 p-6">
            {!st.enabled && <ClosedBanner pid={id} sid={stage} />}
            {st.status === "needs_recheck" && <RecheckBanner pid={id} sid={stage} inputs={st.inputs.map((s) => s.no + s.name).join("・")} />}
            {awaiting && st.pending && <ApprovalPanel pid={id} sid={stage} version={st.pending.version} findings={st.audit_findings ?? []} />}
            {tab === "canvas" && <Canvas pid={id} st={st} readOnly={readOnly} />}
            {tab === "doc" && <DocEditor pid={id} sid={stage} markdown={st.markdown} fields={st.framework.fields} readOnly={readOnly} />}
            {tab === "history" && (
              <div className="card divide-y divide-zinc-100">
                {st.versions.length === 0 && <p className="p-6 text-center text-[13px] text-zinc-500">まだ版はありません。</p>}
                {st.versions.map((v) => (
                  <div key={v.version} className="flex items-center gap-4 px-5 py-3 text-[13px]">
                    <span className="w-10 font-semibold">v{v.version}</span>
                    {v.version === st.approved_version ? <span className="chip border-emerald-200 text-emerald-700">最新版</span>
                      : v.confirmed ? <span className="chip">過去の版</span> : <span className="chip border-amber-200 text-amber-700">承認待ち・差し戻し</span>}
                    <span className="font-mono text-[11px] text-zinc-400">{v.sha256.slice(0, 12)}</span>
                    <span className="ml-auto text-xs text-zinc-400">{new Date(v.created_at).toLocaleString("ja-JP")}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
        <AiDrawer initial={drawer} references={st.references} decisions={st.decisions} sessions={st.sessions} sessionId={st.session_id} report={st.report} pid={id} sid={stage} chat={st.chat} fields={st.framework.fields} prompts={st.framework.prompts}
          disabled={!st.enabled ? "ステージを開くと対話できます" : null} />
      </div>
    </div>
  );
}
