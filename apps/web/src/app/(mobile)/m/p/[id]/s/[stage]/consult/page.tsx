import { agent } from "@/lib/agent";
import { SubHeader } from "@/components/mobile/MobileBits";
import { MobileConsult } from "@/components/mobile/MobileConsult";
import type { ConsultView } from "@/app/(app)/p/[id]/s/[stage]/consult/actions";

// スマホの相談（工程の担当＝その分野の専門家と対話する）
export default async function MobileConsultPage({ params }: { params: Promise<{ id: string; stage: string }> }) {
  const { id, stage } = await params;
  const v = await agent<ConsultView>(`/products/${id}/stages/${stage}/consult`);
  return (
    <div>
      <SubHeader back={`/p/${id}/s/${stage}`} title={`${v.agent.name}との相談`} sub="決めたことは合意メモに残り、下書きの土台になる" pc={false} />
      <MobileConsult sid={stage} name={v.agent.name} notes={v.notes} />
    </div>
  );
}
