"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavItem({ href, children, exact = false, muted = false }: {
  href: string; children: React.ReactNode; exact?: boolean; muted?: boolean;
}) {
  const path = usePathname();
  const on = exact ? path === href : path === href || path.startsWith(href + "/");
  return (
    <Link
      href={href}
      className={`group flex h-8 items-center gap-2 rounded-md px-2 text-[13px] transition-colors ${
        on ? "bg-white font-medium text-zinc-900 shadow-card ring-1 ring-zinc-200" : muted ? "text-zinc-400 hover:bg-zinc-200/60" : "text-zinc-600 hover:bg-zinc-200/60 hover:text-zinc-900"
      }`}
    >
      {children}
    </Link>
  );
}
