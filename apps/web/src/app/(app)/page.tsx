import Link from "next/link";
import { ArrowUpRight, Boxes, Plus, Sparkles } from "lucide-react";
import { agent, type Product } from "@/lib/agent";
import { Logo } from "@/components/Logo";
import { UserMenu } from "@/components/UserMenu";

export default async function Home() {
  const products = await agent<Product[]>("/products");
  return (
    <>
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Logo />
          <UserMenu />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">プロダクト</h1>
          <p className="mt-1 text-zinc-500">アイデアから運用までを、フレームワークとAIとの対話で進めます。</p>
        </div>
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <section>
            {products.length === 0 ? (
              <div className="card flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 text-zinc-500"><Boxes size={18} /></div>
                <div className="font-medium">まだプロダクトがありません</div>
                <p className="max-w-sm text-sm text-zinc-500">「新しいプロダクトをつくる」から、AI との対話で最初のプロダクトを作れます。</p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {products.map((p) => (
                  <Link key={p.id} href={`/p/${p.id}`} className="card group flex flex-col gap-3 p-5 transition hover:-translate-y-0.5 hover:shadow-pop">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-100 to-violet-100 text-sm font-semibold text-brand-700">
                        {p.name.slice(0, 1)}
                      </div>
                      <ArrowUpRight size={16} className="text-zinc-300 transition group-hover:text-zinc-600" />
                    </div>
                    <div>
                      <div className="font-semibold">{p.name}</div>
                      <p className="mt-1 line-clamp-2 text-[13px] text-zinc-500">{p.idea || "意図は未記入"}</p>
                    </div>
                    <div className="mt-auto flex items-center gap-1.5">
                      <span className="chip">{p.scope.toUpperCase()}</span>
                      <span className="chip">{p.mode === "corporate" ? "法人" : "個人"}</span>
                      {p.status === "stopped" && <span className="chip border-rose-200 text-rose-600">中止</span>}
                      <span className="ml-auto text-[11px] text-zinc-400">{new Date(p.created_at).toLocaleDateString("ja-JP")}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
          <div className="card h-fit space-y-3 p-5">
            <div className="flex items-center gap-2 font-semibold"><Sparkles size={16} className="text-brand-600" />新しいプロダクト</div>
            <p className="text-[13px] leading-6 text-zinc-500">AI が質問するので、答えていくだけで作れます。答えた内容は①リーンキャンバスの下書きに入ります。</p>
            <Link href="/new" className="btn-primary w-full"><Plus size={16} />新しいプロダクトをつくる</Link>
          </div>
        </div>
      </main>
    </>
  );
}
