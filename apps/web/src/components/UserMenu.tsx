import Link from "next/link";
import { LogOut, Settings } from "lucide-react";
import { auth } from "@/lib/auth";
import { logout } from "@/app/(app)/actions";

export async function UserMenu({ compact = false }: { compact?: boolean }) {
  const session = await auth();
  const email = session?.user?.email ?? "";
  const mode = session?.user?.mode === "corporate" ? "法人" : "個人";
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
      <Link href="/settings" className="btn-ghost btn-sm" title="設定" aria-label="設定"><Settings size={14} /></Link>
      <form action={logout}>
        <button className="btn-ghost btn-sm" title="ログアウト"><LogOut size={14} /></button>
      </form>
    </div>
  );
}
