import Link from "next/link";
import { redirect } from "next/navigation";
import { agent, type Product } from "@/lib/agent";

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
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-4 text-2xl font-bold text-deep">プロダクト</h1>
      <div className="grid gap-6 md:grid-cols-2">
        <section className="space-y-2">
          {products.length === 0 && <p className="text-muted">まだプロダクトがありません。</p>}
          {products.map((p) => (
            <Link key={p.id} href={`/p/${p.id}`} className="card block hover:bg-pale">
              <div className="font-bold text-deep">{p.name}</div>
              <div className="text-sm text-muted">{p.idea || "（意図なし）"}</div>
              <div className="mt-1 text-xs text-muted">{p.scope.toUpperCase()}・{p.status === "stopped" ? "中止" : "進行中"}</div>
            </Link>
          ))}
        </section>
        <form action={create} className="card space-y-3">
          <h2 className="font-bold text-deep">新しいプロダクト</h2>
          <input name="name" required placeholder="プロダクト名" className="input" />
          <textarea name="idea" rows={4} placeholder="作りたいもの・解きたい課題（①アイディエーションの入力になります）" className="input" />
          <label className="block text-sm">
            スコープ
            <select name="scope" className="input mt-1">
              <option value="mvp">mvp（全ステージ）</option>
              <option value="poc">poc（②③を省略）</option>
            </select>
          </label>
          <button className="btn-primary">作成</button>
        </form>
      </div>
    </main>
  );
}
