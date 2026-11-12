import Link from "next/link";
import { ArrowRight, CheckCircle2, CircleSlash, FilePen, Sparkles } from "lucide-react";
import { agent, type DocSummary, type ImportDoc, type Overview } from "@/lib/agent";
import { PageHeader } from "@/components/PageHeader";
import { AutoRefresh } from "@/components/autodev/AutoRefresh";
import { ImportForm } from "@/components/import/ImportForm";
import { ReadersEditor } from "@/components/import/ReadersEditor";
import { ActionForm } from "@/components/team/ActionForm";
import { createDoc } from "../team-actions";

const STATUS: Record<ImportDoc["status"], { label: string; cls: string }> = {
  queued: { label: "待機中", cls: "bg-zinc-100 text-zinc-600" }, running: { label: "割り当て中", cls: "bg-sky-100 text-sky-800" },
  done: { label: "完了", cls: "bg-emerald-100 text-emerald-800" }, failed: { label: "失敗", cls: "bg-rose-100 text-rose-800" },
};
const ACTION = {
  filled: { label: "入れた", icon: CheckCircle2, cls: "text-emerald-600" },
  proposed: { label: "案を出した", icon: Sparkles, cls: "text-brand-600" },
  dropped: { label: "外した", icon: CircleSlash, cls: "text-zinc-400" },
};

const when = (t: string) => new Date(t).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

// ドキュメント：手で書く Markdown と、取り込んだ資料（PDF・Excel・Word・PowerPoint・テキスト）を1か所に並べる。
// 取り込んだ資料は、どの工程のどの項目にあたるかを AI が見分けて入れ（または承認待ちの案にし）、読んでいいエージェントが読む
export default async function DocsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ doc?: string }> }) {
  const { id } = await params;
  const { doc } = await searchParams;
  const [ov, docs, written, versions] = await Promise.all([
    agent<Overview>(`/products/${id}`), agent<ImportDoc[]>(`/products/${id}/imports`), agent<DocSummary[]>(`/products/${id}/docs`),
    agent<Record<string, string>>("/avatars").catch(() => ({} as Record<string, string>)),
  ]);
  const all = [
    ...docs.map((d) => ({ kind: "import" as const, key: `i${d.id}`, title: d.filename, at: d.created_at, d })),
    ...written.map((w) => ({ kind: "doc" as const, key: w.key, title: w.title, at: w.updated_at, w })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));
  const selId = Number(doc) || docs[0]?.id;
  const sel = selId ? await agent<ImportDoc>(`/products/${id}/imports/${selId}`).catch(() => null) : null;
  const stageOf = Object.fromEntries(ov.stages.map((s) => [s.id, s]));
  const byStage = new Map<string, ImportDoc["result"]>();
  for (const r of sel?.result ?? []) byStage.set(r.stage, [...(byStage.get(r.stage) ?? []), r]);
  const active = docs.some((d) => d.status === "queued" || d.status === "running");

  return (
    <>
      <AutoRefresh active={active} />
      <PageHeader
        crumbs={<><Link href={`/p/${id}`} className="hover:text-zinc-700">ダッシュボード</Link><span>/</span><span>ドキュメント</span></>}
        title="ドキュメント"
        sub="手で書くドキュメントと、取り込んだ資料（PDF・Excel・Word・PowerPoint・テキスト）。取り込んだ資料は、どの工程のどの項目にあたるかを AI が見分けて入れます（資料に書かれていないことは入れません）。"
      />
      <div className="grid gap-6 px-8 py-6 xl:grid-cols-[400px_minmax(0,1fr)]">
        <div className="space-y-4">
          <ImportForm pid={id} stages={ov.stages} />
          <ActionForm action={createDoc.bind(null, id)} submit="書き始める" className="card flex items-end gap-3 p-4">
            <div className="flex-1"><label className="label" htmlFor="doc-title">または、新しく書く（Markdown）</label><input id="doc-title" name="title" className="input" placeholder="タイトル" required /></div>
          </ActionForm>
          <div className="card divide-y divide-zinc-100" aria-label="ドキュメントの一覧">
            <div className="px-4 py-2.5 text-[12px] font-semibold text-zinc-500">ドキュメント（{all.length}）</div>
            {all.length === 0 && <p className="px-4 py-4 text-[13px] text-zinc-400">まだありません</p>}
            {all.map((x) => x.kind === "import" ? (
              <Link key={x.key} href={`/p/${id}/docs?doc=${x.d.id}`} className={`flex items-center gap-2 px-4 py-2.5 text-[13px] hover:bg-zinc-50 ${x.d.id === sel?.id ? "bg-brand-50/50" : ""}`}>
                <span className="min-w-0 flex-1 truncate font-medium">{x.title}</span>
                <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">{x.d.kind_label}</span>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS[x.d.status].cls}`}>{STATUS[x.d.status].label}</span>
              </Link>
            ) : (
              <Link key={x.key} href={`/p/${id}/docs/${x.w.number}`} className="flex items-center gap-2 px-4 py-2.5 text-[13px] hover:bg-zinc-50">
                <FilePen size={13} className="shrink-0 text-zinc-400" />
                <span className="min-w-0 flex-1 truncate font-medium">{x.title}</span>
                <span className="shrink-0 font-mono text-[10px] text-zinc-400">{x.w.key}</span>
                <span className="shrink-0 text-[10.5px] text-zinc-400">{when(x.at)}</span>
              </Link>
            ))}
          </div>
        </div>
        {sel ? (
          <div className="min-w-0 space-y-4">
            <div className="card p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[15px] font-semibold">{sel.filename}</h2>
                <span className="chip">{sel.kind_label}</span>
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS[sel.status].cls}`}>{STATUS[sel.status].label}</span>
                <span className="text-[12px] text-zinc-500">{sel.mode === "fill" ? "空の項目には直接入れる" : "AI の案として出す"}・{sel.chars.toLocaleString()}文字・{sel.created_by}</span>
                {sel.job_id && <Link href={`/jobs/${sel.job_id}`} className="ml-auto text-[12px] text-brand-700 hover:underline">ジョブの工程を見る</Link>}
              </div>
              {sel.outline.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">{sel.outline.slice(0, 40).map((h, i) => <span key={i} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600">{h}</span>)}</div>
              )}
            </div>
            {sel.status === "done" && (
              <ReadersEditor key={sel.id + sel.readers.join()} pid={id} doc={sel.id} readers={sel.readers} custom={sel.readers_custom} stages={ov.stages} versions={versions} />
            )}
            {sel.status === "done" && byStage.size === 0 && (
              <div className="card p-5 text-[13px] text-zinc-500">この資料には、工程の項目にあたる具体的な中身が見つかりませんでした。</div>
            )}
            {[...byStage.entries()].map(([sid, rows]) => {
              const s = stageOf[sid];
              return (
                <div key={sid} className="card p-5">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-[14px] font-semibold">{s?.no} {s?.name}</span>
                    <Link href={rows.some((r) => r.action === "proposed") ? `/p/${id}#approvals` : `/p/${id}/s/${sid}`} className="ml-auto flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:underline">
                      {rows.some((r) => r.action === "proposed") ? "ダッシュボードで承認する" : "工程を開く"}<ArrowRight size={12} />
                    </Link>
                  </div>
                  <ul className="divide-y divide-zinc-100">
                    {rows.map((r, i) => {
                      const a = ACTION[r.action];
                      return (
                        <li key={i} className="flex items-start gap-2 py-2 text-[13px]">
                          <a.icon size={14} className={`mt-0.5 shrink-0 ${a.cls}`} />
                          <span className="w-40 shrink-0 font-medium">{r.label}</span>
                          <span className={`w-20 shrink-0 text-[12px] ${a.cls}`}>{a.label}</span>
                          <span className="min-w-0 text-[12px] text-zinc-500">{r.reason}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
            {sel.preview && (
              <details className="card p-5">
                <summary className="cursor-pointer select-none text-[13px] font-medium">読み取った文章（冒頭）</summary>
                <pre className="mt-3 max-h-[480px] overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-[11px] leading-5 text-zinc-700">{sel.preview}</pre>
              </details>
            )}
          </div>
        ) : (
          <div className="card flex items-center justify-center p-10 text-[13px] text-zinc-400">資料を取り込むと、ここに工程ごとの割り当てが出ます（手で書いたドキュメントは、一覧から開いて編集します）</div>
        )}
      </div>
    </>
  );
}
