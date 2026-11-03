import { Suspense } from "react";
import { agent, type Product } from "@/lib/agent";
import { MobileHome, Row } from "@/components/mobile/MobileHome";

// スマホのファクトリー全体：チャット（ファクトリー全体）｜承認｜プロダクト
export default async function MobileFactory() {
  const products = await agent<Product[]>("/products").catch(() => [] as Product[]);
  const list = (
    <div>
      {products.length === 0 && <p className="py-8 text-center text-[13px] text-zinc-400">まだプロダクトがありません。PC 版の「新しいプロダクトをつくる」から作れます。</p>}
      {products.map((p) => <Row key={p.id} href={`/p/${p.id}`} title={p.name} sub={p.idea} right={p.cycle ? <span className="text-[11px] text-zinc-400">サイクル {p.cycle}</span> : null} />)}
    </div>
  );
  return <Suspense><MobileHome progressLabel="プロダクト" progress={list} /></Suspense>;
}
