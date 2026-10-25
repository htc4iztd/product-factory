import Link from "next/link";
import { Plus } from "lucide-react";
import { agent, type Decision, type Overview } from "@/lib/agent";
import { PageHeader } from "@/components/PageHeader";
import { ActionForm } from "@/components/team/ActionForm";
import { RefChips, RefText, when } from "@/components/team/RefText";
import { DECISION_STATUS, PROVIDERS } from "@/components/team/labels";
import { createDecision, decide } from "../team-actions";

function Source({ pid, d }: { pid: string; d: Decision }) {
  const s = d.source;
  if (!s) return null;
  if (s.kind === "meeting") return <>会議 <RefText pid={pid} text={String(s.id)} /></>;
  if (s.kind === "thread") return <>議論のスレッド{s.provider ? `（${PROVIDERS[s.provider] ?? s.provider}）` : ""}{s.url && <> <a className="underline" href={s.url} target="_blank" rel="noreferrer">元の会話</a></>}</>;
  if (s.kind === "manual") return <>手入力</>;
  return <>{s.kind}</>;
}

export default async function DecisionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [list, ov] = await Promise.all([agent<Decision[]>(`/products/${id}/decisions`), agent<Overview>(`/products/${id}`)]);
  const stageName = Object.fromEntries(ov.stages.map((s) => [s.id, `${s.no} ${s.name}`]));
  const proposed = list.filter((d) => d.status === "proposed");
  const rest = list.filter((d) => d.status !== "proposed");
  const stageSelect = (name: string, value?: string | null) => (
    <select name={name} defaultValue={value ?? ""} className="input h-8 py-1 text-xs" aria-label="関係するステージ">
      <option value="">ステージ：—</option>{ov.stages.map((s) => <option key={s.id} value={s.id}>{s.no} {s.name}</option>)}
    </select>
  );
  return (
    <>
      <PageHeader crumbs={<span>チーム</span>} title="決定記録"
        sub="会話・会議・外部のツールで決まったこと。確定した決定は、関係するステージの AI の対話に前提として渡り、ステージの参照にも出ます。" />
      <div className="mx-auto max-w-4xl space-y-6 px-8 py-6">
        <details className="card p-4">
          <summary className="flex cursor-pointer items-center gap-1.5 text-[13px] font-medium"><Plus size={14} />決定を書く</summary>
          <ActionForm action={createDecision.bind(null, id)} submit="記録" className="mt-3 space-y-3">
            <div><label className="label" htmlFor="d-title">決めたこと</label><input id="d-title" name="title" className="input" required /></div>
            <div><label className="label" htmlFor="d-detail">内容</label><textarea id="d-detail" name="detail" rows={3} className="input" /></div>
            <div><label className="label" htmlFor="d-why">理由</label><textarea id="d-why" name="rationale" rows={2} className="input" /></div>
            <div className="flex items-center gap-3">{stageSelect("stage_id")}<label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="confirmed" />確定として記録する</label></div>
          </ActionForm>
        </details>

        <section aria-label="確定待ち" className="space-y-3">
          <div className="section-title">確定待ち（{proposed.length}）</div>
          {proposed.length === 0 && <p className="text-[13px] text-zinc-400">ありません。議論のスレッドや会議から AI が抜き出すと、ここに並びます。</p>}
          {proposed.map((d) => (
            <article key={d.key} id={d.key} className="card scroll-mt-6 border-amber-200 p-4">
              <div className="mb-1 flex items-center gap-2 text-[11px] text-zinc-400">
                <span className="font-mono">{d.key}</span><span className="chip border-amber-200 bg-amber-50 text-amber-700">確定待ち</span>
                <span>起点：<Source pid={id} d={d} /></span><span className="ml-auto">{d.proposed_by}・{when(d.created_at)}</span>
              </div>
              <h2 className="text-[14px] font-semibold"><RefText pid={id} text={d.title} /></h2>
              {d.detail && d.detail !== d.title && <p className="mt-1 whitespace-pre-wrap text-[13px] text-zinc-700"><RefText pid={id} text={d.detail} /></p>}
              {d.rationale && <p className="mt-1 text-xs text-zinc-500">理由：{d.rationale}</p>}
              {d.refs.length > 0 && <div className="mt-2"><RefChips pid={id} refs={d.refs} /></div>}
              <ActionForm action={decide.bind(null, id, d.number)} submit="確定する" reset={false} className="mt-3 flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-3">
                <input type="hidden" name="status" value="confirmed" />
                {stageSelect("stage_id", d.stage_id)}
                <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="create_ticket" />反映するチケットを作る</label>
              </ActionForm>
              <ActionForm action={decide.bind(null, id, d.number)} submit="却下する" reset={false} className="mt-2">
                <input type="hidden" name="status" value="rejected" />
              </ActionForm>
            </article>
          ))}
        </section>

        <section aria-label="記録済み" className="space-y-2">
          <div className="section-title">記録済み（{rest.length}）</div>
          {rest.map((d) => (
            <article key={d.key} id={d.key} className={`card scroll-mt-6 p-4 ${d.status !== "confirmed" ? "opacity-60" : ""}`}>
              <div className="mb-1 flex items-center gap-2 text-[11px] text-zinc-400">
                <span className="font-mono">{d.key}</span>
                <span className={`chip ${d.status === "confirmed" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : ""}`}>{DECISION_STATUS[d.status]}</span>
                {d.stage_id && <Link href={`/p/${id}/s/${d.stage_id}`} className="chip hover:border-brand-300">{stageName[d.stage_id]}</Link>}
                <span>起点：<Source pid={id} d={d} /></span>
                <span className="ml-auto">{d.decided_by}・{when(d.decided_at)}</span>
              </div>
              <h2 className="text-[14px] font-semibold"><RefText pid={id} text={d.title} /></h2>
              {d.detail && d.detail !== d.title && <p className="mt-1 whitespace-pre-wrap text-[13px] text-zinc-700"><RefText pid={id} text={d.detail} /></p>}
              {d.rationale && <p className="mt-1 text-xs text-zinc-500">理由：{d.rationale}</p>}
              {d.refs.length > 0 && <div className="mt-2"><RefChips pid={id} refs={d.refs} /></div>}
            </article>
          ))}
        </section>
      </div>
    </>
  );
}
