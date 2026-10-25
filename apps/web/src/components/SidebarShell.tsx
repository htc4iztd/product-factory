"use client";
import { useEffect, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

// サイドバーの表示・非表示。状態は cookie に残し、ページを移っても・再読み込みしても保つ
export function SidebarShell({ initialOpen, sidebar, children }: { initialOpen: boolean; sidebar: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(initialOpen);
  const toggle = (v: boolean) => {
    setOpen(v);
    document.cookie = `pf_nav=${v ? "open" : "closed"}; path=/; max-age=31536000; samesite=lax`;
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== "[" || e.metaKey || e.ctrlKey || e.altKey || t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      e.preventDefault();
      toggle(!open);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <div className="flex min-h-screen">
      {open && (
        <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-zinc-200 bg-zinc-100/70">
          <button onClick={() => toggle(false)} className="btn-ghost btn-sm absolute right-2 top-2 z-10 h-7 w-7 p-0" title="サイドバーを隠す（[）" aria-label="サイドバーを隠す">
            <PanelLeftClose size={15} />
          </button>
          {sidebar}
        </aside>
      )}
      {!open && (
        <button onClick={() => toggle(true)} className="btn-secondary fixed left-2 top-2 z-30 h-8 w-8 p-0" title="サイドバーを表示（[）" aria-label="サイドバーを表示">
          <PanelLeftOpen size={15} />
        </button>
      )}
      <main className={`min-w-0 flex-1 ${open ? "" : "pl-10"}`}>{children}</main>
    </div>
  );
}
