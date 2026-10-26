import Link from "next/link";
import { ChevronLeft, Download } from "lucide-react";
import { agent, type Ontology } from "@/lib/agent";
import { auth } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { UserMenu } from "@/components/UserMenu";
import { OntologyEditor } from "@/components/knowledge/OntologyEditor";

export default async function OntologyPage() {
  const [g, session] = await Promise.all([agent<Ontology>("/ontology"), auth()]);
  const canEdit = session?.user?.role !== "VIEWER";
  const proposed = g.concepts.filter((c) => c.status === "proposed").length;
  return (
    <>
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6"><Logo /><UserMenu /></div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-6 py-10">
        <div>
          <Link href="/" className="mb-3 flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900"><ChevronLeft size={14} />すべてのプロダクト</Link>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">社内のオントロジー</h1>
              <p className="mt-1 text-sm text-zinc-500">
                社内の用語・組織・役割・業務・システムと、その関係です。AI は扱う文章に出てくる名前・別名に関係する部分だけを、その都度前提として受け取ります（ステージの対話・自動開発・会話からの抜き出し）。
              </p>
            </div>
            <div className="ml-auto flex gap-2">
              <a href="/api/ontology/export?format=turtle" className="btn-secondary btn-sm"><Download size={13} />Turtle</a>
              <a href="/api/ontology/export?format=json-ld" className="btn-secondary btn-sm"><Download size={13} />JSON-LD</a>
            </div>
          </div>
          <p className="mt-2 text-xs text-zinc-500">{g.concepts.length - proposed}件の概念・{g.relations.length}件の関係{proposed ? `・承認待ちの候補 ${proposed}件` : ""}。書き出しは SKOS（W3C の語彙の標準）です。</p>
        </div>
        <OntologyEditor g={g} canEdit={canEdit} />
      </main>
    </>
  );
}
