export function PageHeader({ crumbs, title, sub, actions, children }: {
  crumbs?: React.ReactNode; title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="px-8 pb-5 pt-5">
        {crumbs && <div className="mb-2 flex items-center gap-1.5 text-xs text-zinc-400">{crumbs}</div>}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2.5 text-xl font-semibold tracking-tight">{title}</h1>
            {sub && <div className="mt-1 text-[13px] text-zinc-500">{sub}</div>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
        {children}
      </div>
    </header>
  );
}
