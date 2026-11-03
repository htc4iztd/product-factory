import Link from "next/link";
import { notFound } from "next/navigation";
import { agent, AgentError, type StageDetail } from "@/lib/agent";
import { auth } from "@/lib/auth";
import { ConsultRoom } from "@/components/consult/ConsultRoom";
import type { ConsultView } from "./actions";

// 工程の担当（その分野の専門家）との相談：問いを立てて導いてもらい、決めたことを合意メモに残す
export default async function ConsultPage({ params }: { params: Promise<{ id: string; stage: string }> }) {
  const { id, stage } = await params;
  const [view, st, session] = await Promise.all([
    agent<ConsultView>(`/products/${id}/stages/${stage}/consult`).catch((e) => { if (e instanceof AgentError && e.status === 404) notFound(); throw e; }),
    agent<StageDetail>(`/products/${id}/stages/${stage}`),
    auth(),
  ]);
  const readOnly = session?.user?.role === "VIEWER" || !st.enabled;
  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-2 border-b border-zinc-200 bg-white px-6 py-3">
        <Link href={`/p/${id}/s/${stage}`} className="whitespace-nowrap text-[12px] text-zinc-500 hover:text-zinc-800">{st.no} {st.name}</Link><span className="text-zinc-300">/</span>
        <h1 className="whitespace-nowrap text-[15px] font-semibold">{view.agent.name}との相談</h1>
        <span className="ml-2 hidden text-[11.5px] text-zinc-500 xl:block">この分野の専門家と対話して、ゼロから磨き上げます。決めたことは合意メモに残り、下書きの土台になります。</span>
      </header>
      <div className="min-h-0 flex-1 p-3"><ConsultRoom pid={id} sid={stage} initial={view} readOnly={readOnly} /></div>
    </div>
  );
}
