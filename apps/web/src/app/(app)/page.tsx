import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, Boxes, Plus } from "lucide-react";
import { agent, type Product } from "@/lib/agent";
import { Logo } from "@/components/Logo";
import { UserMenu } from "@/components/UserMenu";

export default async function Home() {
  const products = await agent<Product[]>("/products");
  async function create(formData: FormData) {
    "use server";
    const p = await agent<Product>("/products", {
      method: "POST",
      body: {
        name: String(formData.get("name") ?? ""),
        idea: String(formData.get("idea") ?? ""),
        scope: String(formData.get("scope") ?? "mvp"),
      },
    });
    redirect(`/p/${p.id}`);
  }
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
                <p className="max-w-sm text-sm text-zinc-500">右のフォームから最初のプロダクトを作ると、リーンキャンバスから始められます。</p>
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
          <form action={create} className="card h-fit space-y-4 p-5">
            <div className="flex items-center gap-2 font-semibold"><Plus size={16} />新しいプロダクト</div>
            <div>
              <label className="label" htmlFor="name">名前</label>
              <input id="name" name="name" required placeholder="例：家計簿アプリ" className="input" />
            </div>
            <div>
              <label className="label" htmlFor="idea">作りたいもの・解きたい課題</label>
              <textarea id="idea" name="idea" rows={4} placeholder="誰のどんな課題を、どう解きたいか。AIとの対話の出発点になります。" className="input" />
            </div>
            <fieldset>
              <legend className="label">進め方</legend>
              <div className="grid grid-cols-2 gap-2">
                {[["mvp", "MVP", "全工程を使う"], ["poc", "PoC", "市場・競合分析を閉じる"]].map(([v, t, d]) => (
                  <label key={v} className="cursor-pointer rounded-lg border border-zinc-200 p-3 text-[13px] has-[:checked]:border-brand-500 has-[:checked]:ring-4 has-[:checked]:ring-brand-100">
                    <input type="radio" name="scope" value={v} defaultChecked={v === "mvp"} className="sr-only" />
                    <div className="font-medium">{t}</div>
                    <div className="text-[11px] text-zinc-500">{d}</div>
                  </label>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-zinc-400">使うステージと承認の要否は、あとから設定で変えられます。</p>
            </fieldset>
            <button className="btn-primary w-full">作成</button>
          </form>
        </div>
      </main>
    </>
  );
}
