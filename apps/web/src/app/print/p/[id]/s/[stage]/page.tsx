import { redirect } from "next/navigation";
import { agent, type Overview, type StageDetail } from "@/lib/agent";
import { auth } from "@/lib/auth";
import { Md } from "@/components/md/Md";
import { PrintNow } from "./PrintNow";

// 工程の成果物の印刷用ページ（PDF に保存する）。チャットやメニューは出さない。図（Mermaid）も描いてから印刷する
export default async function PrintStage({ params }: { params: Promise<{ id: string; stage: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { id, stage } = await params;
  const [st, ov] = await Promise.all([agent<StageDetail>(`/products/${id}/stages/${stage}`), agent<Overview>(`/products/${id}`)]);
  const at = new Date().toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" });
  return (
    <main className="mx-auto max-w-[800px] bg-white px-10 py-10 text-[13px] leading-relaxed text-zinc-900 print:px-0 print:py-0">
      <PrintNow />
      <header className="mb-6 border-b border-zinc-200 pb-4">
        <div className="text-[12px] text-zinc-500">{ov.product.name}</div>
        <h1 className="text-[22px] font-bold">{st.no} {st.name}</h1>
        <div className="text-[12px] text-zinc-500">{st.framework.title}・{st.approved_version ? `版 v${st.approved_version}` : "版なし"}・{at}</div>
      </header>
      <article className="space-y-2 [&_h1]:mt-6 [&_h1]:text-[18px] [&_h1]:font-bold [&_h2]:mt-6 [&_h2]:break-after-avoid [&_h2]:border-b [&_h2]:border-zinc-200 [&_h2]:pb-1 [&_h2]:text-[16px] [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-6 [&_table]:w-full [&_table]:border-collapse [&_table]:text-[11.5px] [&_td]:border [&_td]:border-zinc-300 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-zinc-300 [&_th]:bg-zinc-100 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_tr]:break-inside-avoid [&_ul]:list-disc [&_ul]:pl-6">
        <Md>{st.markdown}</Md>
      </article>
    </main>
  );
}
