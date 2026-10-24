import Markdown from "react-markdown";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { agent, AgentError, type StageDetail } from "@/lib/agent";
import { StatusChip } from "@/components/StatusChip";

type Props = { params: Promise<{ id: string; stage: string }>; searchParams: Promise<{ error?: string; tab?: string }> };

export default async function StagePage({ params, searchParams }: Props) {
  const { id, stage } = await params;
  const sp = await searchParams;
  const st = await agent<StageDetail>(`/products/${id}/stages/${stage}`);
  const here = `/p/${id}/s/${stage}`;

  async function call(path: string, body?: unknown) {
    "use server";
    try {
      await agent(path, { method: "POST", body });
    } catch (e) {
      if (e instanceof AgentError) redirect(`${here}?error=${encodeURIComponent(e.message)}`);
      throw e;
    }
    revalidatePath(`/p/${id}`, "layout");
    redirect(here);
  }
  async function start() {
    "use server";
    await call(`/products/${id}/stages/${stage}/start`);
  }
  async function answer(formData: FormData) {
    "use server";
    await call(`/products/${id}/stages/${stage}/respond`, { answer: String(formData.get("answer") ?? "") });
  }
  async function decide(formData: FormData) {
    "use server";
    await call(`/products/${id}/stages/${stage}/respond`, {
      decision: String(formData.get("decision")),
      comment: String(formData.get("comment") ?? ""),
    });
  }

  const pending = st.pending;
  const canStart = !pending && ["not_started", "revising", "needs_recheck", "completed"].includes(st.status);
  const tab = sp.tab ?? "doc";
  const questions = (pending?.payload?.questions as string[] | undefined) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-deep">{st.no} {st.name}</h1>
          <StatusChip status={st.status} />
        </div>
        {canStart && (
          <form action={start}>
            <button className="btn-primary">{st.status === "not_started" ? "このステージを始める" : "やり直す"}</button>
          </form>
        )}
      </div>
      <p className="text-sm text-muted">
        成果物：{st.artifact_name}／必須の見出し：{st.required_sections.join("・")}
        {st.approved_version > 0 && `／承認済みの版：v${st.approved_version}`}
      </p>
      {sp.error && <div className="rounded border border-amber bg-amber-light p-3 text-sm">{sp.error}</div>}

      {pending?.kind === "clarify" && (
        <form action={answer} className="card space-y-3 border-amber">
          <h2 className="font-bold text-deep">確認質問</h2>
          <ul className="list-disc pl-5 text-sm">{questions.map((q) => <li key={q}>{q}</li>)}</ul>
          <textarea name="answer" rows={5} required className="input" placeholder="回答（そのまま監査ログに残ります）" />
          <button className="btn-accent">回答して成果物を作る</button>
        </form>
      )}

      {st.artifact && (
        <section className="card">
          <div className="mb-3 flex gap-4 border-b text-sm">
            {[["doc", "文書"], ["meta", "版と監査"]].map(([k, l]) => (
              <a key={k} href={`${here}?tab=${k}`} className={`pb-2 ${tab === k ? "border-b-2 border-amber font-bold text-deep" : "text-muted"}`}>{l}</a>
            ))}
          </div>
          {tab === "doc" ? (
            <div className="prose-md text-sm"><Markdown>{st.artifact.content}</Markdown></div>
          ) : (
            <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
              <dt className="text-muted">現在の版</dt><dd>v{st.artifact.version}{st.artifact.approved && "（承認済み）"}</dd>
              <dt className="text-muted">SHA-256</dt><dd className="font-mono text-xs">{st.artifact.sha256}</dd>
              <dt className="text-muted">ビルダーの回答</dt><dd className="whitespace-pre-wrap">{st.answers}</dd>
            </dl>
          )}
        </section>
      )}

      {pending?.kind === "approval" && (
        <form action={decide} className="card space-y-3 border-2 border-amber">
          <h2 className="font-bold text-deep">承認（v{String(pending.payload?.version ?? st.current_version)}）</h2>
          <div className="text-sm">
            <div className="font-bold">監査エージェントの指摘</div>
            {(st.audit_findings ?? []).length === 0 ? (
              <p className="text-muted">なし（必須の見出しと本文がそろっています）</p>
            ) : (
              <ul className="list-disc pl-5 text-amber">{st.audit_findings!.map((f) => <li key={f}>{f}</li>)}</ul>
            )}
            {Boolean(pending.payload?.escalated) && <p className="mt-1 font-bold text-amber">作り直しの上限を超えたため、指摘付きで承認に回っています</p>}
          </div>
          <textarea name="comment" rows={3} className="input" placeholder="理由・修正指示（Request Changes と Accept as-is では必須）" />
          <div className="flex gap-2">
            <button name="decision" value="Approve" className="btn-accent">Approve</button>
            <button name="decision" value="Request Changes" className="btn-ghost">Request Changes</button>
            <button name="decision" value="Accept as-is" className="btn-ghost">Accept as-is</button>
          </div>
        </form>
      )}
    </div>
  );
}
