"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity, BookText, Bot, Boxes, ChevronLeft, Code2, Command, Diamond, FileInput, FileText, ImageIcon, KanbanSquare,
  LayoutDashboard, Megaphone, MessagesSquare, Network, Presentation, ScrollText, Settings2, Video,
} from "lucide-react";
import type { Phase, Product, StageSummary, TeamMember } from "@/lib/agent";
import { GROUPS } from "@/lib/groups";
import { Avatar, STATE_LABEL, type AgentState } from "./Avatar";

export type RailAgent = TeamMember & { state: AgentState };
const GROUP_TONE: Record<string, string> = { 事業: "pf-g-biz", "要求・設計": "pf-g-design", 構築: "pf-g-build", リリース: "pf-g-release" };

// 左のレール：ページではなく「人」を並べる。司令塔と PM、各工程の担当（顔・状態・未読）。道具は下に小さく
export function AgentRail({ pid, product, agents, versions, stages, phases, footer }: {
  pid: string; product: Product; agents: RailAgent[]; versions: Record<string, string>; stages: StageSummary[]; phases: Phase[];
  footer: React.ReactNode;
}) {
  const path = usePathname();
  const by = Object.fromEntries(agents.map((a) => [a.key, a]));
  const st = Object.fromEntries(stages.map((s) => [s.id, s]));
  const ph = Object.fromEntries(phases.map((p) => [p.id, p]));
  const open = () => window.dispatchEvent(new Event("pf:command"));
  const tools: [string, string, typeof Bot][] = [
    [`/p/${pid}`, "ダッシュボード", LayoutDashboard], [`/p/${pid}/board`, "掲示板", Megaphone],
    [`/p/${pid}/team`, "エージェントの組織", Network], [`/p/${pid}/canvas`, "プロダクト・キャンバス", ImageIcon],
    [`/p/${pid}/import`, "資料の取り込み", FileInput], [`/p/${pid}/reports`, "報告資料", Presentation],
    [`/p/${pid}/agents`, "定期の仕事", Bot], [`/p/${pid}/preproducts`, "プリプロダクト", Boxes],
    [`/jobs?product=${pid}`, "ジョブ", Activity], [`/p/${pid}/talk`, "議論", MessagesSquare],
    [`/p/${pid}/tickets`, "チケット", KanbanSquare], [`/p/${pid}/decisions`, "決定記録", BookText],
    [`/p/${pid}/meetings`, "会議", Video], [`/p/${pid}/docs`, "ドキュメント", FileText],
    [`/p/${pid}/code`, "コード（IDE）", Code2], [`/p/${pid}/settings`, "ステージの設定", Settings2],
    [`/p/${pid}/audit`, "監査ログ", ScrollText],
  ];
  const on = (href: string) => (href === `/p/${pid}` ? path === href : path === href || path.startsWith(href + "/"));

  const Person = ({ a, href, big, label, sub, muted }: { a?: RailAgent; href: string; big?: boolean; label: string; sub?: string; muted?: boolean }) => {
    const state: AgentState = muted ? "off" : a?.state ?? "idle";
    return (
      <Link href={href} title={a ? `${a.name}：${STATE_LABEL[state]}${a.report?.summary ? `\n${a.report.summary}` : ""}` : label}
        className={`group flex items-center gap-2 rounded-lg px-1.5 ${big ? "py-1.5" : "py-1"} transition ${on(href) ? "bg-white shadow-card ring-1 ring-zinc-200" : "hover:bg-white/70"}`}>
        <Avatar k={a?.key ?? "director"} v={versions[a?.key ?? ""]} size={big ? 34 : 26} state={state} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate ${big ? "text-[13px] font-semibold" : "text-[12.5px]"} ${muted ? "text-zinc-400" : "text-zinc-800"}`}>{label}</span>
          {sub && <span className="block truncate text-[10.5px] text-zinc-500">{sub}</span>}
        </span>
        {!!a?.unread && <span className="rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-white" title="未読">{a.unread}</span>}
        {a?.state === "waiting" && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title="PdM の返事待ち" />}
      </Link>
    );
  };

  return (
    <>
      <div className="px-3 pb-2 pt-3">
        <Link href="/" className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900"><ChevronLeft size={14} />すべてのプロダクト</Link>
        <Link href={`/p/${pid}`} title="このプロダクトのダッシュボード" className="mt-3 flex items-center gap-2 rounded-md px-1 py-1 transition hover:bg-zinc-100">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-brand-500 to-violet-500 text-xs font-semibold text-white">{product.name.slice(0, 1)}</div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold">{product.name}</div>
            <div className="text-[11px] text-zinc-400">{product.scope.toUpperCase()}・{product.mode === "corporate" ? "法人" : "個人"}</div>
          </div>
        </Link>
        <button onClick={open} className="mt-3 flex w-full items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-left text-[12px] text-zinc-500 shadow-sm hover:border-brand-300">
          <Command size={13} className="text-brand-600" /><span className="flex-1">話しかける・移動する</span><span className="kbd">⌘K</span>
        </button>
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto px-2.5 py-2" aria-label="エージェント">
        <div className="space-y-0.5">
          <Person a={by.director} href={`/p/${pid}`} big label="司令塔" sub={by.director?.memory?.strategy ? `戦略：${by.director.memory.strategy}` : "PdM と戦略を決める"} />
          <Person a={by.pm} href={`/p/${pid}/board?agent=pm`} big label="PM" sub={by.pm?.report?.summary ?? "工程を横ぐしで見る"} />
        </div>
        {GROUPS.map((g) => (
          <div key={g.title} className={GROUP_TONE[g.title]}>
            <div className="mb-1 flex items-center gap-1.5 px-1.5"><span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--pf-g)" }} /><span className="section-title">{g.title}</span></div>
            <div className="space-y-0.5 border-l-2 pl-1" style={{ borderColor: "color-mix(in srgb, var(--pf-g) 35%, transparent)" }}>
              {g.phases.flatMap((p) => ph[p]?.stages ?? []).map((sid) => {
                const s = st[sid];
                const a = by[sid];
                const sub = !s.enabled ? "閉じている" : a?.state === "working" ? "作業中…" : a?.report ? `${a.report.progress}%・${a.report.summary}` : undefined;
                return <Person key={sid} a={a} href={`/p/${pid}/s/${sid}`} label={`${s.no} ${s.name}`} sub={sub} muted={!s.enabled} />;
              })}
            </div>
          </div>
        ))}
        <div>
          <div className="section-title mb-1 px-1.5">道具</div>
          <div className="grid grid-cols-2 gap-0.5">
            {tools.map(([href, label, Icon]) => (
              <Link key={href} href={href} title={label}
                className={`flex h-8 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-[12px] transition ${on(href) ? "bg-white font-medium text-zinc-900 shadow-card ring-1 ring-zinc-200" : "text-zinc-600 hover:bg-white hover:text-zinc-900"}`}>
                <Icon size={14} className="shrink-0 text-zinc-500" /><span className="truncate">{label}</span>
              </Link>
            ))}
          </div>
          <div className="section-title mb-1 mt-3 px-1.5">振り返り</div>
          <div className="space-y-0.5">
            {phases.filter((p) => p.gate).map((p) => (
              <Link key={p.id} href={`/p/${pid}/g/${p.id}`} title={`振り返り ${p.gate} ${p.gate_question}`}
                className={`flex h-8 items-center gap-1.5 rounded-md px-1.5 text-[12px] transition ${on(`/p/${pid}/g/${p.id}`) ? "bg-white font-medium shadow-card ring-1 ring-zinc-200" : "text-zinc-600 hover:bg-white"}`}>
                <Diamond size={12} className={`shrink-0 ${p.review ? "text-emerald-500" : "text-zinc-400"}`} />
                <span className="truncate">{p.gate} {p.gate_question}</span>
              </Link>
            ))}
          </div>
        </div>
      </nav>
      {footer}
    </>
  );
}
