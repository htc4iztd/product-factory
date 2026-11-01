import Link from "next/link";
import { agent, type FrameworkDefT } from "@/lib/agent";
import { auth } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { FrameworkLibrary } from "@/components/framework/FrameworkEditor";

// フレームワークのライブラリとエディタ（テナントで共通）。工程には工程の画面から足す
export default async function FrameworksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [lib, session] = await Promise.all([agent<{ frameworks: FrameworkDefT[]; kinds: Record<string, string> }>("/frameworks"), auth()]);
  const canEdit = ["OWNER", "ADMIN"].includes(session?.user?.role ?? "");
  return (
    <>
      <PageHeader
        crumbs={<><Link href={`/p/${id}`} className="hover:text-zinc-700">ダッシュボード</Link><span>/</span><span>フレームワーク</span></>}
        title="フレームワーク"
        sub="PEST・ファイブフォース・SWOT・BMC などの標準と、独自のフレームワーク。部品（文章・箇条書き・表・2×2・ポジショニング図・図）を格子に並べて定義し、工程の画面から足します"
      />
      <div className="px-8 py-6"><FrameworkLibrary pid={id} frameworks={lib.frameworks} kinds={lib.kinds} canEdit={canEdit} /></div>
    </>
  );
}
