import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Logo } from "@/components/Logo";
import { UserMenu } from "@/components/UserMenu";
import { IntakeChat } from "@/components/IntakeChat";

export default function NewProductPage() {
  return (
    <>
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6"><Logo /><UserMenu /></div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Link href="/" className="mb-3 flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900"><ChevronLeft size={14} />すべてのプロダクト</Link>
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">新しいプロダクトをつくる</h1>
        <p className="mb-6 text-sm text-zinc-500">AI の質問に答えてください。分かったことは右にまとまり、そのまま①リーンキャンバスの下書きになります。</p>
        <IntakeChat />
      </main>
    </>
  );
}
