import Link from "next/link";
import { notFound } from "next/navigation";
import { agent, type Overview, type Row, type StageDetail } from "@/lib/agent";
import { auth } from "@/lib/auth";
import { UiEditor, type UiPage } from "@/components/ui-design/UiEditor";
import { UiProto } from "@/components/ui-design/UiProto";
import type { Proto } from "./actions";

// ⑥UXデザインの UI：プロトタイプ（画面の移り方まで操作できる1つの HTML。触る・コメントで AI に直させる）と、
// 画面の部品（画面ごとの HTML を部品で組むエディタ。プロトタイプの材料になる）
export default async function UiPageEditor({ params, searchParams }: {
  params: Promise<{ id: string; stage: string }>; searchParams: Promise<{ mode?: string; page?: string }>;
}) {
  const { id, stage } = await params;
  const { mode, page } = await searchParams;
  if (stage !== "s06") notFound();
  const [st, ov, session] = await Promise.all([agent<StageDetail>(`/products/${id}/stages/s06`), agent<Overview>(`/products/${id}`), auth()]);
  const value = (st.draft.ui as unknown as { pages: UiPage[]; proto?: Proto }) ?? { pages: [] };
  const rows = ((st.draft.screens as Row[]) ?? []).filter((r) => String(r.id ?? "").trim());
  const screens = rows.map((r) => ({ id: String(r.id), name: String(r.name ?? "") }));
  const str = (rs: Row[]) => rs.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? "")])));
  const memo = str(rows);
  const flows = str(((st.draft.userflows as Row[]) ?? []).filter((r) => String(r.steps ?? "").trim()));
  const readOnly = session?.user?.role === "VIEWER" || !st.enabled;
  const edit = mode === "edit";
  const q = page ? `&page=${encodeURIComponent(page)}` : "";
  const tab = (on: boolean) => `whitespace-nowrap rounded-md px-3 py-1 text-[12.5px] ${on ? "bg-zinc-900 font-medium text-white" : "text-zinc-600 hover:bg-zinc-100"}`;
  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-2 border-b border-zinc-200 bg-white px-6 py-3">
        <Link href={`/p/${id}/s/s06`} className="whitespace-nowrap text-[12px] text-zinc-500 hover:text-zinc-800">⑥ UXデザイン</Link><span className="text-zinc-300">/</span>
        <h1 className="text-[15px] font-semibold">UI</h1>
        <nav className="ml-2 flex gap-1" aria-label="UI の見方">
          <Link href={`/p/${id}/s/s06/ui?mode=proto${q}`} className={tab(!edit)} aria-current={!edit ? "page" : undefined}>プロトタイプ</Link>
          <Link href={`/p/${id}/s/s06/ui?mode=edit${q}`} className={tab(edit)} aria-current={edit ? "page" : undefined}>画面の部品</Link>
        </nav>
        <span className="ml-2 hidden text-[11.5px] text-zinc-500 xl:block">{edit
          ? "部品をクリックで選び、ダブルクリックで文字を書き換え、右の欄で部品を足す・並べ替える・見た目を整えます。"
          : "画面の移り方まで操作できる1つの HTML です。押して確かめ、「コメント」で部品を押して指摘を残せます。AI に送ると直した版が承認依頼で届きます。"}</span>
      </header>
      <div className="min-h-0 flex-1 p-3">
        {edit ? <UiEditor pid={id} value={value} screens={screens} readOnly={readOnly} initialPage={page} />
          : <UiProto pid={id} product={ov.product.name} proto={value.proto ?? null} pages={value.pages ?? []} screens={memo} flows={flows} readOnly={readOnly} me={session?.user?.email ?? ""} />}
      </div>
    </div>
  );
}
