export function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className="flex items-center gap-2 font-semibold tracking-tight text-zinc-900">
      <span className={`flex items-center justify-center rounded-lg bg-zinc-900 text-white ${small ? "h-6 w-6 text-[11px]" : "h-8 w-8 text-sm"}`}>PF</span>
      <span className={small ? "text-[13px]" : "text-base"}>Product Factory</span>
    </span>
  );
}
