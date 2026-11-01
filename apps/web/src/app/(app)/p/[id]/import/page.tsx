import { redirect } from "next/navigation";

// 資料の取り込みはドキュメントに一本化した（古いリンクのため残す）
export default async function ImportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ doc?: string }> }) {
  const { id } = await params;
  const { doc } = await searchParams;
  redirect(`/p/${id}/docs${doc ? `?doc=${doc}` : ""}`);
}
