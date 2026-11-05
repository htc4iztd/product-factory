"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity, Bot, Boxes, ChevronLeft, Code2, Command, FileText, ImageIcon,
  CalendarClock, ClipboardCheck, LayoutTemplate, Rocket, UserCog, LayoutDashboard, ListChecks, Megaphone, Network, Presentation, ScrollText, Settings2,
} from "lucide-react";
import type { Phase, PlatformSummary, Product, StageSummary, TeamMember } from "@/lib/agent";
import { GROUPS } from "@/lib/groups";
import { Avatar, STATE_LABEL, type AgentState } from "./Avatar";

export type RailAgent = TeamMember & { state: AgentState };
const GROUP_TONE: Record<string, string> = { 事業: "pf-g-biz", "要求・設計": "pf-g-design", 構築: "pf-g-build", リリース: "pf-g-release" };

// 左のレール：ページではなく「人」を並べる。事業・設計・実装の PM と、各工程の担当（顔・状態・自分宛ての Issue）。道具は下に小さく
const POLL_MS = 5000;
const hms = (d: Date) => d.toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit" });

// エージェントの状態を数秒ごとに読み直す（画面を開いている間だけ。どのページにいてもレールは最新）
function useLiveTeam(pid: string, initial: RailAgent[], initialPlatform: PlatformSummary | undefined, initialTick: string | null) {
  const [agents, setAgents] = useState(initial);
  const [platform, setPlatform] = useState(initialPlatform);
  const [tickAt, setTickAt] = useState(initialTick);
  const [at, setAt] = useState<Date | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setAgents(initial); }, [initial]);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch(`/api/p/${pid}/team-status`, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const t = await r.json();
        if (!alive) return;
        setAgents(t.agents); setPlatform(t.platform); setTickAt(t.beats?.tick?.at ?? null); setAt(new Date()); setFailed(false);
      } catch {
        if (alive) setFailed(true);
      }
    };
    const loop = async () => { await load(); if (alive) timer = setTimeout(loop, POLL_MS); };
    loop();
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; clearTimeout(timer); document.removeEventListener("visibilitychange", onVis); };
  }, [pid]);
  return { agents, platform, tickAt, at, failed };
}

export function AgentRail({ pid, product, agents: initial, platform: initialPlatform, tickAt: initialTick = null, versions, stages, phases, footer }: {
  pid: string; product: Product; agents: RailAgent[]; platform?: PlatformSummary; tickAt?: string | null;
  versions: Record<string, string>; stages: StageSummary[]; phases: Phase[]; footer: React.ReactNode;
}) {
  const path = usePathname();
  const { agents, platform, tickAt, at, failed } = useLiveTeam(pid, initial, initialPlatform, initialTick);
  const [, setNow] = useState(0);
  useEffect(() => { const t = setInterval(() => setNow((n) => n + 1), 15000); return () => clearInterval(t); }, []);
  const tickMin = tickAt ? Math.floor((Date.now() - new Date(tickAt).getTime()) / 60000) : null;
  const tickOk = tickMin !== null && tickMin <= 5;
  const working = agents.filter((a) => a.state === "working").length;
  const by = Object.fromEntries(agents.map((a) => [a.key, a]));
  const st = Object.fromEntries(stages.map((s) => [s.id, s]));
  const ph = Object.fromEntries(phases.map((p) => [p.id, p]));
  const open = () => window.dispatchEvent(new Event("pf:command"));
  const tools: [string, string, typeof Bot][] = [
    [`/p/${pid}`, "ダッシュボード", LayoutDashboard], [`/p/${pid}/review`, "プロダクトレビュー", ClipboardCheck], [`/p/${pid}/release`, "リリース", Rocket], [`/p/${pid}/issues`, "Issue", ListChecks],
[`/p/${pid}/board`, "掲示板", Megaphone],
    [`/p/${pid}/team`, "エージェントの組織", Network], [`/p/${pid}/cast`, "ペルソナ・スキル", UserCog], [`/p/${pid}/schedule`, "スケジュール", CalendarClock], [`/p/${pid}/frameworks`, "フレームワーク", LayoutTemplate], [`/p/${pid}/canvas`, "プロダクト・キャンバス", ImageIcon],
    [`/p/${pid}/reports`, "報告資料", Presentation],
    [`/p/${pid}/agents`, "定期の仕事", Bot], [`/p/${pid}/preproducts`, "プリプロダクト", Boxes],
    [`/jobs?product=${pid}`, "ジョブ", Activity],
    [`/p/${pid}/docs`, "ドキュメント", FileText],
    [`/p/${pid}/code`, "開発（コード）", Code2], [`/p/${pid}/settings`, "ステージの設定", Settings2],
    [`/p/${pid}/audit`, "監査ログ", ScrollText],
  ];
  const on = (href: string) => (href === `/p/${pid}` ? path === href : path === href || path.startsWith(href + "/"));

  const Person = ({ a, href, big, label, sub, muted }: { a?: RailAgent; href: string; big?: boolean; label: string; sub?: string; muted?: boolean }) => {
    const state: AgentState = muted ? "off" : a?.state ?? "idle";
    const live = a?.state === "working" ? "作業中" : a?.state === "stuck" ? "詰まっている" : "";
    return (
      <Link href={href} title={a ? `${a.name}：${STATE_LABEL[state]}${a.report?.summary ? `\n${a.report.summary}` : ""}` : label}
        className={`group flex items-center gap-2 rounded-lg px-1.5 ${big ? "py-1.5" : "py-1"} transition ${on(href) ? "bg-white shadow-card ring-1 ring-zinc-200" : "hover:bg-white/70"}`}>
        <Avatar k={a?.key ?? "pm_biz"} v={versions[a?.key ?? ""]} size={big ? 34 : 26} state={state} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate ${big ? "text-[13px] font-semibold" : "text-[12.5px]"} ${muted ? "text-zinc-400" : "text-zinc-800"}`}>{label}</span>
          {(live || sub) && <span className={`block truncate text-[10.5px] ${a?.state === "working" ? "font-medium text-brand-700" : a?.state === "stuck" ? "text-rose-600" : "text-zinc-500"}`}>{live && !big ? `${live}・` : ""}{sub}</span>}
        </span>
        {!!a?.open_issues && <span className="rounded-full bg-violet-500 px-1.5 text-[10px] font-bold text-white" title="自分宛ての終わっていない Issue">{a.open_issues}</span>}
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
      <div className="mx-2.5 mb-1 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[10.5px] text-zinc-500" role="status" aria-label="エージェントのライブ表示"
        title={`エージェントの状態を ${POLL_MS / 1000} 秒ごとに読み直しています`}>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${failed ? "bg-rose-500" : at ? "bg-emerald-500 animate-pulse" : "bg-zinc-300"}`} />
        <span className="truncate">{failed ? "状態を読めません（再試行中）" : at ? `状態の更新 ${hms(at)}` : "状態を読んでいます…"}</span>
        <span className={`ml-auto shrink-0 ${tickOk ? "text-zinc-500" : "font-medium text-rose-600"}`} title="定期実行（tick）が最後に来た時刻">
          {tickMin === null ? "定期実行：記録なし" : `定期実行 ${tickMin < 1 ? "1分以内" : `${tickMin}分前`}`}
        </span>
      </div>
      {working > 0 && <div className="mx-2.5 mb-1 px-1.5 text-[10.5px] font-medium text-brand-700">{working} 人が作業中</div>}
      <nav className="flex-1 space-y-4 overflow-y-auto px-2.5 py-2" aria-label="エージェント">
        <Link href={`/p/${pid}/platform`} title="プラットフォーム：このプロダクトの稼働を見張り、PdM と直接話します"
          className={`flex items-center gap-2 rounded-lg px-1.5 py-1.5 transition ${on(`/p/${pid}/platform`) ? "bg-white shadow-card ring-1 ring-zinc-200" : "hover:bg-white/70"}`}>
          <Avatar k="platform" v={versions.platform} size={30} state={platform?.high ? "stuck" : "idle"} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-semibold text-zinc-800">プラットフォーム</span>
            <span className={`block truncate text-[10.5px] ${platform?.high ? "text-rose-600" : "text-zinc-500"}`}>
              {platform?.open ? `稼働の問題 ${platform.open} 件${platform.high ? `（重い ${platform.high}）` : ""}` : "未対応の稼働の問題はありません"}
            </span>
          </span>
          {!!platform?.open && <span className={`rounded-full px-1.5 text-[10px] font-bold text-white ${platform.high ? "bg-rose-500" : "bg-amber-500"}`} title="未対応の稼働の問題">{platform.open}</span>}
        </Link>
        <div className="space-y-0.5">
          {(["pm_biz", "pm_design", "pm_impl"] as const).map((k) => (
            <Person key={k} a={by[k]} href={`/p/${pid}/pm/${k}`} big label={by[k]?.name ?? k}
              sub={by[k]?.report?.summary ?? ({ pm_biz: "①〜⑤ 事業", pm_design: "⑥〜⑪ 要求・設計", pm_impl: "⑫〜⑬ 構築" } as Record<string, string>)[k]} />
          ))}
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
          <div className="space-y-0.5">
            {tools.map(([href, label, Icon]) => (
              <Link key={href} href={href} title={label}
                className={`flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-[12.5px] transition ${on(href) ? "bg-white font-medium text-zinc-900 shadow-card ring-1 ring-zinc-200" : "text-zinc-600 hover:bg-white hover:text-zinc-900"}`}>
                <Icon size={14} className="shrink-0 text-zinc-500" /><span className="truncate">{label}</span>
              </Link>
            ))}
          </div>
        </div>
      </nav>
      {footer}
    </>
  );
}
