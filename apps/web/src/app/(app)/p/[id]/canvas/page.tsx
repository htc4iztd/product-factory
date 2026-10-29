import Link from "next/link";
import { Download, ImageIcon, Sparkles } from "lucide-react";
import { agent, type CanvasInfo } from "@/lib/agent";
import { PageHeader } from "@/components/PageHeader";
import { CopyLink, GenerateForm, ImageActions } from "@/components/canvas/CanvasControls";

export default async function CanvasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cv = await agent<CanvasInfo>(`/products/${id}/canvas`);
  const cover = cv.images.find((i) => i.id === cv.product.cover_image_id) ?? null;
  const src = (img: string) => `/api/p/${id}/images/${img}`;

  return (
    <>
      <PageHeader
        crumbs={<><Link href={`/p/${id}`} className="hover:text-zinc-700">ダッシュボード</Link><span>/</span><span>プロダクト・キャンバス</span></>}
        title="プロダクト・キャンバス"
        sub="プロダクトの全体像を1枚の絵にして、関わる人と同じイメージを持つための場所です。"
        actions={<>
          <CopyLink />
          {cover && <a href={src(cover.id)} download className="btn-secondary"><Download size={14} />表紙をダウンロード</a>}
        </>}
      />
      <div className="space-y-8 px-8 py-6">
        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="self-start overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-card">
            {cover ? (
              <figure>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src(cover.id)} alt={`${cv.product.name} のプロダクトイメージ（${cv.kinds[cover.kind]}）`} className="aspect-video w-full object-cover" />
                <figcaption className="flex items-center gap-2 border-t border-zinc-100 px-4 py-3 text-[13px]">
                  <span className="font-semibold">{cv.product.name}</span>
                  <span className="chip">{cv.kinds[cover.kind]}</span>
                  {cover.note && <span className="truncate text-zinc-500">{cover.note}</span>}
                  <span className="ml-auto text-xs text-zinc-400">{new Date(cover.created_at).toLocaleString("ja-JP")}</span>
                </figcaption>
              </figure>
            ) : (
              <div className="flex aspect-video flex-col items-center justify-center gap-3 bg-gradient-to-br from-brand-50 to-violet-50 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-brand-600 shadow-card"><ImageIcon size={22} /></div>
                <div className="font-semibold">まだ絵がありません</div>
                <p className="max-w-sm text-[13px] text-zinc-500">右のフォームから生成すると、最初の1枚がこのプロダクトの表紙になります。</p>
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <div className="card p-4">
              <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold"><Sparkles size={14} className="text-brand-600" />絵を生成する</div>
              <GenerateForm pid={id} kinds={cv.kinds} model={cv.model} first={cv.images.length === 0} />
            </div>
            <div className="card p-4">
              <div className="mb-2 text-[13px] font-semibold">絵の元になる情報</div>
              {cv.facts.length === 0 ? (
                <p className="text-xs text-zinc-500">
                  <Link href={`/p/${id}/s/s01`} className="text-brand-700 hover:underline">①リーンキャンバス</Link>や
                  <Link href={`/p/${id}/s/s04`} className="text-brand-700 hover:underline">④バリュープロポジション</Link>を埋めると、絵に反映されます。今はプロダクトの意図だけを使います。
                </p>
              ) : (
                <dl className="space-y-2">
                  {cv.facts.map((f) => (
                    <div key={f.stage + f.label}>
                      <dt className="flex items-center gap-1.5 text-[11px] text-zinc-400">{f.label}<span className="chip px-1 py-0 text-[10px]">{f.stage}・{f.source}</span></dt>
                      <dd className="line-clamp-3 text-xs text-zinc-700">{f.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </aside>
        </section>

        <section>
          <h2 className="section-title mb-3">これまでの絵（{cv.images.length}）</h2>
          {cv.images.length === 0 ? (
            <p className="text-[13px] text-zinc-500">生成した絵はここに並びます。</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {cv.images.map((img) => (
                <div key={img.id} className={`card overflow-hidden ${img.id === cv.product.cover_image_id ? "ring-2 ring-amber-300" : ""}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src(img.id)} alt={`${cv.kinds[img.kind]}の画像`} loading="lazy" className="aspect-video w-full bg-zinc-100 object-cover" />
                  <div className="space-y-2 p-3">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="chip shrink-0 whitespace-nowrap">{cv.kinds[img.kind]}</span>
                      {img.base_id && <span className="chip shrink-0" title="前の絵を元に直したもの">直した絵</span>}
                      <span className="truncate text-zinc-500" title={img.note}>{img.note}</span>
                      <span className="ml-auto shrink-0 text-[11px] text-zinc-400">{new Date(img.created_at).toLocaleDateString("ja-JP")}</span>
                    </div>
                    <ImageActions pid={id} id={img.id} isCover={img.id === cv.product.cover_image_id} />
                    <details className="text-[11px] text-zinc-500">
                      <summary className="cursor-pointer select-none">使ったプロンプト（{img.model}）</summary>
                      <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md bg-zinc-50 p-2 font-sans">{img.prompt}</pre>
                    </details>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
