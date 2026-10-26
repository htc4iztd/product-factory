import Link from "next/link";
import { Activity, Bell, LogOut, Settings } from "lucide-react";
import { agent, type Notices } from "@/lib/agent";
import { auth } from "@/lib/auth";
import { logout } from "@/app/(app)/actions";

export async function UserMenu({ compact = false }: { compact?: boolean }) {
  const session = await auth();
  const email = session?.user?.email ?? "";
  const mode = session?.user?.mode === "corporate" ? "法人" : "個人";
  const unread = await agent<Notices>("/notices").then((n) => n.unread).catch(() => 0);
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-violet-500 text-[11px] font-semibold text-white">
        {email.slice(0, 1).toUpperCase()}
      </div>
      {!compact && (
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-xs font-medium text-zinc-800">{email}</div>
          <div className="text-[11px] text-zinc-400">{session?.user?.role ?? "-"}・{mode}モード</div>
        </div>
      )}
      <Link href="/notices" className="btn-ghost btn-sm relative" title="通知" aria-label={unread ? `通知（未読 ${unread}件）` : "通知"}>
        <Bell size={14} />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[14px] rounded-full bg-rose-500 px-1 text-center text-[9px] font-semibold leading-[14px] text-white">{unread > 9 ? "9+" : unread}</span>}
      </Link>
      <Link href="/jobs" className="btn-ghost btn-sm" title="ジョブ" aria-label="ジョブ"><Activity size={14} /></Link>
      <Link href="/settings" className="btn-ghost btn-sm" title="設定" aria-label="設定"><Settings size={14} /></Link>
      <form action={logout}>
        <button className="btn-ghost btn-sm" title="ログアウト"><LogOut size={14} /></button>
      </form>
    </div>
  );
}
