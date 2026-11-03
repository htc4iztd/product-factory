import { notFound } from "next/navigation";
import { agent, AgentError, STATUS_LABEL, type StageDetail } from "@/lib/agent";
import { Md } from "@/components/md/Md";
import { SubHeader } from "@/components/mobile/MobileBits";
import { ExportMenu } from "@/components/stage/ExportMenu";

// スマホの工程：成果物を文書として読む。直したいことは下の入力欄で頼む（話題はこの工程）
export default async function MobileStage({ params }: { params: Promise<{ id: string; stage: string }> }) {
  const { id, stage } = await params;
  const st = await agent<StageDetail>(`/products/${id}/stages/${stage}`).catch((e) => { if (e instanceof AgentError && e.status === 404) notFound(); throw e; });
  return (
    <div>
      <SubHeader back={`/p/${id}?tab=progress`} title={`${st.no} ${st.name}`} sub={<>{STATUS_LABEL[st.status] ?? st.status}{st.missing.length > 0 && `・未記入 ${st.missing.length}`}</>} />
      <div className="flex justify-end px-2 pt-1"><ExportMenu compact printHref={`/print/p/${id}/s/${stage}`} doc={{
        title: `${st.no} ${st.name}`, subtitle: st.framework.title, markdown: st.markdown, filename: `${st.no}${st.name}`.replace(/[\\/:*?"<>|\s]+/g, "_"),
      }} /></div>
      {st.missing.length > 0 && <p className="mx-3 mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">まだ書いていない項目：{st.missing.join("・")}</p>}
      <article className="max-w-none space-y-2 px-4 py-4 text-[14px] leading-relaxed [&_h1]:mt-2 [&_h1]:text-[18px] [&_h1]:font-bold [&_h2]:mt-5 [&_h2]:border-b [&_h2]:border-zinc-100 [&_h2]:pb-1 [&_h2]:text-[16px] [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:text-[14.5px] [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_table]:block [&_table]:overflow-x-auto [&_table]:text-[12px] [&_td]:border [&_td]:border-zinc-200 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-zinc-200 [&_th]:bg-zinc-50 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left">
        {st.markdown.trim() ? <Md>{st.markdown}</Md> : <p className="text-zinc-400">まだ中身がありません。下の入力欄で担当に頼めます。</p>}
      </article>
    </div>
  );
}
