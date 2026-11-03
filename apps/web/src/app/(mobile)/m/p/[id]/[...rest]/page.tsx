import { PcOnly } from "@/components/mobile/MobileBits";

export default async function MobileProductFallback({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PcOnly back={`/p/${id}`} />;
}
