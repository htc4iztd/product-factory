import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { agent, type Notices } from "@/lib/agent";
import { Logo } from "@/components/Logo";
import { UserMenu } from "@/components/UserMenu";
import { when } from "@/components/team/RefText";
import { readNotices } from "@/app/(app)/p/[id]/team-actions";

const KIND: Record<string, string> = { mention: "メンション", assigned: "担当", decision: "決定" };

export default async function NoticesPage() {
  const n = await agent<Notices>("/notices");
  return (
    <>
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-6"><Logo /><UserMenu /></div>
      </header>
      <main className="mx-auto max-w-4xl space-y-6 px-6 py-10">
        <div>
          <Link href="/" className="mb-3 flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900"><ChevronLeft size={14} />すべてのプロダクト</Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">通知</h1>
            {n.unread > 0 && <form action={readNotices}><button className="btn-secondary btn-sm">すべて既読にする（{n.unread}）</button></form>}
          </div>
        </div>
        <div className="card divide-y divide-zinc-100">
          {n.items.length === 0 && <p className="p-5 text-[13px] text-zinc-400">通知はありません。</p>}
          {n.items.map((x) => (
            <Link key={x.id} href={x.link} className={`flex items-start gap-3 px-5 py-3 text-[13px] hover:bg-zinc-50 ${x.read ? "text-zinc-500" : ""}`}>
              {!x.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" />}
              <span className="chip shrink-0">{KIND[x.kind] ?? x.kind}</span>
              <span className="min-w-0 flex-1 truncate">{x.text}</span>
              <span className="shrink-0 text-xs text-zinc-400">{x.actor}・{when(x.created_at)}</span>
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
