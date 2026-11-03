import { notFound } from "next/navigation";
import { agent, type StageDetail } from "@/lib/agent";
import { auth } from "@/lib/auth";
import { MobileProto } from "@/components/mobile/MobileProto";
import { SubHeader } from "@/components/mobile/MobileBits";
import type { Proto } from "@/app/(app)/p/[id]/s/[stage]/ui/actions";

// スマホの UI プロトタイプ：触る・部品にコメントして AI に直させる（作る・コードはスマホでは「AI で作る」だけ）
export default async function MobileUi({ params }: { params: Promise<{ id: string; stage: string }> }) {
  const { id, stage } = await params;
  if (stage !== "s06") notFound();
  const [st, session] = await Promise.all([agent<StageDetail>(`/products/${id}/stages/s06`), auth()]);
  const proto = ((st.draft.ui as unknown as { proto?: Proto }) ?? {}).proto ?? null;
  return (
    <div className="flex h-full flex-col">
      <SubHeader back={`/p/${id}?tab=progress`} title="UI のプロトタイプ" sub="触って確かめる・部品にコメントして直させる" />
      <div className="min-h-0 flex-1"><MobileProto pid={id} proto={proto} me={session?.user?.email ?? ""} readOnly={session?.user?.role === "VIEWER" || !st.enabled} /></div>
    </div>
  );
}
