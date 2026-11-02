import Link from "next/link";
import { notFound } from "next/navigation";
import { agent, type Row, type StageDetail } from "@/lib/agent";
import { auth } from "@/lib/auth";
import { UiEditor, type UiPage } from "@/components/ui-design/UiEditor";

// ⑥UXデザインの UI エディタ（自作）。手で編集し、右のチャットで AI に頼むと承認依頼で反映される
export default async function UiPageEditor({ params }: { params: Promise<{ id: string; stage: string }> }) {
  const { id, stage } = await params;
  if (stage !== "s06") notFound();
  const [st, session] = await Promise.all([agent<StageDetail>(`/products/${id}/stages/s06`), auth()]);
  const value = (st.draft.ui as unknown as { pages: UiPage[] }) ?? { pages: [] };
  const screens = ((st.draft.screens as Row[]) ?? []).filter((r) => String(r.id ?? "").trim()).map((r) => ({ id: String(r.id), name: String(r.name ?? "") }));
  const readOnly = session?.user?.role === "VIEWER" || !st.enabled;
  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-2 border-b border-zinc-200 bg-white px-6 py-3">
        <Link href={`/p/${id}/s/s06`} className="text-[12px] text-zinc-500 hover:text-zinc-800">⑥ UXデザイン</Link><span className="text-zinc-300">/</span>
        <h1 className="text-[15px] font-semibold">UI エディタ</h1>
        <span className="text-[11.5px] text-zinc-500">画面の部品をクリックで選び、ダブルクリックで文字を書き換え、右の欄で部品を足す・並べ替える・見た目を整えます。AI に頼むときは右のチャットへ（承認すると反映）</span>
      </header>
      <div className="min-h-0 flex-1 p-3"><UiEditor pid={id} value={value} screens={screens} readOnly={readOnly} /></div>
    </div>
  );
}
