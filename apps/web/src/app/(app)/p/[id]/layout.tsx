import Link from "next/link";
import { ChevronLeft, Diamond, LayoutDashboard, ScrollText, Settings2 } from "lucide-react";
import { agent, type Overview } from "@/lib/agent";
import { NavItem } from "@/components/NavItem";
import { StatusDot } from "@/components/StatusBadge";
import { UserMenu } from "@/components/UserMenu";
import { GROUPS } from "@/lib/groups";

export default async function ProductLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ov = await agent<Overview>(`/products/${id}`);
  const stages = Object.fromEntries(ov.stages.map((s) => [s.id, s]));
  const phases = Object.fromEntries(ov.phases.map((p) => [p.id, p]));
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-zinc-200 bg-zinc-100/70">
        <div className="px-3 pb-2 pt-3">
          <Link href="/" className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900">
            <ChevronLeft size={14} />すべてのプロダクト
          </Link>
          <div className="mt-3 flex items-center gap-2 px-1">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-brand-500 to-violet-500 text-xs font-semibold text-white">
              {ov.product.name.slice(0, 1)}
            </div>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold">{ov.product.name}</div>
              <div className="text-[11px] text-zinc-400">{ov.product.scope.toUpperCase()}・{ov.product.mode === "corporate" ? "法人" : "個人"}</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-3">
          <div className="space-y-0.5">
            <NavItem href={`/p/${id}`} exact><LayoutDashboard size={15} />概要</NavItem>
          </div>
          {GROUPS.map((g) => (
            <div key={g.title}>
              <div className="section-title mb-1 px-2">{g.title}</div>
              <div className="space-y-0.5">
                {g.phases.flatMap((pid) => phases[pid].stages).map((sid) => {
                  const s = stages[sid];
                  return (
                    <NavItem key={sid} href={`/p/${id}/s/${sid}`} muted={!s.enabled}>
                      <StatusDot status={s.status} enabled={s.enabled} />
                      <span className="w-4 text-center text-xs text-zinc-400">{s.no}</span>
                      <span className="truncate">{s.name}</span>
                      {s.pending_kind === "approval" && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-amber-500" />}
                    </NavItem>
                  );
                })}
              </div>
            </div>
          ))}
          <div>
            <div className="section-title mb-1 px-2">振り返り</div>
            <div className="space-y-0.5">
              {ov.phases.filter((p) => p.gate).map((p) => (
                <NavItem key={p.id} href={`/p/${id}/g/${p.id}`}>
                  <Diamond size={13} className={p.review ? "text-emerald-500" : "text-zinc-400"} />
                  <span className="truncate">{p.gate} {p.gate_question}</span>
                </NavItem>
              ))}
            </div>
          </div>
          <div>
            <div className="section-title mb-1 px-2">プロダクト</div>
            <div className="space-y-0.5">
              <NavItem href={`/p/${id}/settings`}><Settings2 size={15} />ステージの設定</NavItem>
              <NavItem href={`/p/${id}/audit`}><ScrollText size={15} />監査ログ</NavItem>
            </div>
          </div>
          <div className="px-2 text-[11px] leading-5 text-zinc-400">
            運用ループ（L1〜L5）・トレース・変更要求は R2 で追加します。
          </div>
        </nav>
        <div className="border-t border-zinc-200 p-3"><UserMenu /></div>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
