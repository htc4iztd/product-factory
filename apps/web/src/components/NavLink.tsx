"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, children, disabled }: { href: string; children: React.ReactNode; disabled?: boolean }) {
  const path = usePathname();
  const on = path === href;
  if (disabled) {
    return <span className="block cursor-not-allowed rounded px-2 py-1 text-sm text-gray-400">{children}</span>;
  }
  return (
    <Link
      href={href}
      className={`block rounded px-2 py-1 text-sm ${on ? "border border-amber bg-amber-light font-bold" : "hover:bg-white"}`}
    >
      {children}
    </Link>
  );
}
