import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, CircleDashed, Clock, ImageIcon, Lock } from "lucide-react";
import { agent, type CanvasInfo, type Overview } from "@/lib/agent";
import { GenerateForm } from "@/components/canvas/CanvasControls";
import { GROUPS } from "@/lib/groups";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [ov, cv] = await Promise.all([agent<Overview>(`/products/${id}`), agent<CanvasInfo>(`/products/${id}/canvas`)]);
  const cover = cv.images.find((i) => i.id === cv.product.cover_image_id) ?? null;
  const img = (iid: string) => `/api/p/${id}/images/${iid}`;
  const active = ov.stages.filter((s) => s.enabled);
  const done = active.filter((s) => s.status === "completed").length;
  const waiting = active.filter((s) => s.pending_kind === "approval");
  const recheck = active.filter((s) => s.status === "needs_recheck");
  const phases = Object.fromEntries(ov.phases.map((p) => [p.id, p]));
  const pct = active.length ? Math.round((done / active.length) * 100) : 0;
  const stats = [
    { label: "確定", value: `${done} / ${active.length}`, icon: CheckCircle2, tone: "text-emerald-600" },
    { label: "承認待ち", value: waiting.length, icon: Clock, tone: "text-amber-600" },
    { label: "要再確認", value: recheck.length, icon: AlertTriangle, tone: "text-rose-600" },
    { label: "閉じている", value: ov.stages.length - active.length, icon: CircleDashed, tone: "text-zinc-400" },
  ];
  const todo = [...waiting.map((s) => ({ s, why: "承認待ち" })), ...recheck.map((s) => ({ s, why: "上流の確定版が変わりました" }))];

  return (
    <>
      <PageHeader
        crumbs={<span>概要</span>}
        title={ov.product.name}
        sub={ov.product.idea || "意図は未記入"}
        actions={<Link href={`/p/${id}/settings`} className="btn-secondary">ステージの設定</Link>}
      >
        {ov.product.status === "stopped" && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">このプロダクトは中止されました。</div>
        )}
        <div className="mt-5 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100">
            <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-violet-500" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs tabular-nums text-zinc-500">{pct}%</span>
        </div>
      </PageHeader>
      <div className="space-y-8 px-8 py-6">
        <section className="card grid overflow-hidden lg:grid-cols-[minmax(0,1.7fr)_minmax(300px,1fr)]">
          <div className="relative aspect-video border-b border-zinc-100 bg-zinc-50 lg:aspect-auto lg:min-h-[320px] lg:border-b-0 lg:border-r">
            {cover ? (
              <Link href={`/p/${id}/canvas`} className="absolute inset-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img(cover.id)} alt={`${ov.product.name} のプロダクトイメージ（${cv.kinds[cover.kind]}）`} className="h-full w-full object-cover" />
              </Link>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-brand-50 to-violet-50 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-brand-600 shadow-card"><ImageIcon size={22} /></div>
                <div className="font-semibold">プロダクトの全体像を1枚の絵に</div>
                <p className="max-w-sm px-4 text-[13px] text-zinc-500">①リーンキャンバスと④バリュープロポジションの内容から、画像生成AIが描きます。最初の1枚が表紙になります。</p>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-4 p-5">
            <div>
              <div className="flex items-center gap-2 font-semibold"><ImageIcon size={15} className="text-brand-600" />プロダクト・キャンバス</div>
              <p className="mt-1 text-xs text-zinc-500">関わる人と同じイメージを持つための絵です。中身が変わったら描き直してください。</p>
            </div>
            <GenerateForm pid={id} kinds={cv.kinds} model={cv.model} first={cv.images.length === 0} />
            {cv.images.length > 0 && (
              <div className="mt-auto space-y-2">
                <div className="grid grid-cols-4 gap-1.5">
                  {cv.images.slice(0, 4).map((i) => (
                    <Link key={i.id} href={`/p/${id}/canvas`} className={`overflow-hidden rounded-md ring-1 ${i.id === cover?.id ? "ring-2 ring-amber-300" : "ring-zinc-200"}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img(i.id)} alt={`${cv.kinds[i.kind]}の画像`} loading="lazy" className="aspect-video w-full object-cover" />
                    </Link>
                  ))}
                </div>
                <Link href={`/p/${id}/canvas`} className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
                  すべての絵（{cv.images.length}）と使ったプロンプト<ArrowRight size={12} />
                </Link>
              </div>
            )}
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map(({ label, value, icon: Icon, tone }) => (
            <div key={label} className="card p-4">
              <div className="flex items-center gap-2 text-xs text-zinc-500"><Icon size={14} className={tone} />{label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
            </div>
          ))}
        </section>

        {todo.length > 0 && (
          <section>
            <h2 className="section-title mb-2">対応が必要</h2>
            <div className="card divide-y divide-zinc-100">
              {todo.map(({ s, why }) => (
                <Link key={s.id + why} href={`/p/${id}/s/${s.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50">
                  <span className="w-5 text-zinc-400">{s.no}</span>
                  <span className="font-medium">{s.name}</span>
                  <span className="text-[13px] text-zinc-500">{why}</span>
                  <span className="ml-auto"><StatusBadge status={s.status} /></span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {GROUPS.map((g) => (
          <section key={g.title}>
            <h2 className="section-title mb-2">{g.title}</h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {g.phases.flatMap((pid) => phases[pid].stages).map((sid) => {
                const s = ov.stages.find((x) => x.id === sid)!;
                return (
                  <Link
                    key={sid}
                    href={`/p/${id}/s/${sid}`}
                    className={`group rounded-xl border p-4 transition ${
                      s.enabled ? "card hover:-translate-y-0.5 hover:shadow-pop" : "border-dashed border-zinc-300 bg-transparent opacity-70 hover:opacity-100"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-400">{s.no}・{phases[s.phase].name}</span>
                      <StatusBadge status={s.status} enabled={s.enabled} />
                    </div>
                    <div className="mt-2 font-semibold">{s.name}</div>
                    <div className="mt-0.5 text-[13px] text-zinc-500">{s.framework}</div>
                    <div className="mt-3 flex items-center gap-2 text-[11px] text-zinc-400">
                      {s.approved_version > 0 ? <span>確定版 v{s.approved_version}</span> : <span>未確定</span>}
                      {s.approval_required && <span className="flex items-center gap-1"><Lock size={11} />承認あり</span>}
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
