import Link from "next/link";
import { notFound } from "next/navigation";
import { agent, type Overview, type Row, type StageDetail } from "@/lib/agent";
import { auth } from "@/lib/auth";
import { UiProto } from "@/components/ui-design/UiProto";
import type { ProtoPage } from "@/lib/protoAssemble";
import type { Proto } from "./actions";

// ⑥UXデザインの UI：プロトタイプ（画面の移り方まで操作できる1つの HTML）。AI で作り、触って、コメントで AI に直させる
export default async function UiPrototypePage({ params }: { params: Promise<{ id: string; stage: string }> }) {
  const { id, stage } = await params;
  if (stage !== "s06") notFound();
  const [st, ov, session] = await Promise.all([agent<StageDetail>(`/products/${id}/stages/s06`), agent<Overview>(`/products/${id}`), auth()]);
  const value = (st.draft.ui as unknown as { pages?: ProtoPage[]; proto?: Proto }) ?? {};
  const str = (rs: Row[]) => rs.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? "")])));
  const screens = str(((st.draft.screens as Row[]) ?? []).filter((r) => String(r.id ?? "").trim()));
  const flows = str(((st.draft.userflows as Row[]) ?? []).filter((r) => String(r.steps ?? "").trim()));
  const readOnly = session?.user?.role === "VIEWER" || !st.enabled;
  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-2 border-b border-zinc-200 bg-white px-6 py-3">
        <Link href={`/p/${id}/s/s06`} className="whitespace-nowrap text-[12px] text-zinc-500 hover:text-zinc-800">⑥ UXデザイン</Link><span className="text-zinc-300">/</span>
        <h1 className="whitespace-nowrap text-[15px] font-semibold">UI のプロトタイプ</h1>
        <span className="ml-2 hidden text-[11.5px] text-zinc-500 xl:block">画面の移り方まで操作できる1つの HTML です。押して確かめ、「コメント」で部品を押して指摘を残せます。AI に送ると直した版が承認依頼で届きます。</span>
      </header>
      <div className="min-h-0 flex-1 p-3">
        <UiProto pid={id} product={ov.product.name} proto={value.proto ?? null} pages={value.pages ?? []} screens={screens} flows={flows} readOnly={readOnly} me={session?.user?.email ?? ""} />
      </div>
    </div>
  );
}
