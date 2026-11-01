import { cookies } from "next/headers";
import { SidebarShell } from "@/components/SidebarShell";
import { agent, type Overview, type PlatformSummary } from "@/lib/agent";
import { UserMenu } from "@/components/UserMenu";
import { AgentRail, type RailAgent } from "@/components/rail/AgentRail";
import { CommandBar } from "@/components/rail/CommandBar";

// プロダクトの画面の枠：左は「人」（エージェント）のレール、どこからでも ⌘K で話しかける・移動する
export default async function ProductLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [ov, team, versions] = await Promise.all([
    agent<Overview>(`/products/${id}`),
    agent<{ agents: RailAgent[]; platform?: PlatformSummary; beats?: Record<string, { at: string }> }>(`/products/${id}/team`),
    agent<Record<string, string>>("/avatars").catch(() => ({} as Record<string, string>)),
  ]);
  const navOpen = (await cookies()).get("pf_nav")?.value !== "closed";
  const places = [
    { label: "ダッシュボード", href: `/p/${id}`, hint: "工程とエージェントの状況・PM との対話", keys: "dashboard トップ 全体 状況" },
    { label: "プラットフォーム", href: `/p/${id}/platform`, hint: "ファクトリー全体の稼働・問題と対処", keys: "platform 稼働 障害 エラー 失敗 定期実行" },
    { label: "掲示板", href: `/p/${id}/board`, hint: "エージェント同士のやり取り", keys: "board 履歴 やり取り" },
    { label: "Issue", href: `/p/${id}/issues`, hint: "エージェントの間で動く必要があること", keys: "issue チケット 課題" },
    { label: "振り返りの会議", href: `/p/${id}/meetings-daily`, hint: "PdM と PM の毎日の会議", keys: "meeting 会議 振り返り レポート" },
    { label: "事業PMの作業場所", href: `/p/${id}/pm/pm_biz`, hint: "①〜⑤", keys: "事業PM pm" },
    { label: "設計PMの作業場所", href: `/p/${id}/pm/pm_design`, hint: "⑥〜⑪", keys: "設計PM pm" },
    { label: "実装PMの作業場所", href: `/p/${id}/pm/pm_impl`, hint: "⑫〜⑭", keys: "実装PM pm" },
    { label: "エージェントの組織", href: `/p/${id}/team`, hint: "使命・動く時刻・タスク・顔", keys: "team 組織 タスク 顔" },
    { label: "フレームワーク", href: `/p/${id}/frameworks`, hint: "PEST・5F・SWOT・BMC などと、独自のフレームワークのエディタ", keys: "framework フレームワーク pest swot bmc ファイブフォース 3c stp vrio" },
    { label: "スケジュール", href: `/p/${id}/schedule`, hint: "エージェントが定期的に動く予定と時間割", keys: "schedule スケジュール 予定 定期 時間割 cron" },
    { label: "ペルソナ・スキル・ツール", href: `/p/${id}/cast`, hint: "エージェントの人物像と、使えるスキル・ツール", keys: "persona ペルソナ skill スキル tool ツール 割り当て" },
    { label: "プロダクト・キャンバス", href: `/p/${id}/canvas`, hint: "プロダクトのイメージ画像", keys: "canvas 画像 絵 イメージ" },
    { label: "報告資料", href: `/p/${id}/reports`, hint: "範囲を選んでスライドに", keys: "report 報告 スライド pptx" },
    { label: "定期の仕事", href: `/p/${id}/agents`, hint: "リサーチ更新・報告資料の作り直し", keys: "schedule 定期 cron" },
    { label: "プリプロダクト", href: `/p/${id}/preproducts`, hint: "案（PP-n）と試作", keys: "preproduct 案 試作 パターン" },
    { label: "ジョブ", href: `/jobs?product=${id}`, hint: "動いている処理", keys: "jobs ジョブ" },
    { label: "ドキュメント", href: `/p/${id}/docs`, hint: "書く・Excel・Word・PowerPoint を取り込んで工程に入れる", keys: "docs ドキュメント 資料 取り込み import excel word powerpoint" },
    { label: "コード（IDE）", href: `/p/${id}/code`, hint: "", keys: "code ide コード" },
    { label: "ステージの設定", href: `/p/${id}/settings`, hint: "", keys: "settings 設定 承認" },
    { label: "監査ログ", href: `/p/${id}/audit`, hint: "", keys: "audit 監査 ログ" },
    ...ov.stages.map((s) => ({ label: `${s.no} ${s.name}`, href: `/p/${id}/s/${s.id}`, hint: `${s.framework}`, keys: `${s.id} ${s.name}` })),
  ];
  const agents = [
    { key: "platform", name: "プラットフォーム", keys: "プラットフォーム 稼働 platform" },
    { key: "pm_biz", name: "事業PM", keys: "事業PM 事業 pm_biz" },
    { key: "pm_design", name: "設計PM", keys: "設計PM 設計 pm_design" },
    { key: "pm_impl", name: "実装PM", keys: "実装PM 実装 pm_impl" },
  ];
  const pmOf = Object.fromEntries(team.agents.filter((a) => a.role === "pm").flatMap((a) => a.domain.map((s) => [s, a.key])));
  const stageKeys = ov.stages.map((s) => ({ id: s.id, label: `${s.no}${s.name}`, keys: `${s.no} ${s.name} ${s.id}`, pm: pmOf[s.id] ?? "pm_biz" }));
  return (
    <SidebarShell initialOpen={navOpen} sidebar={
      <AgentRail pid={id} product={ov.product} agents={team.agents} platform={team.platform} tickAt={team.beats?.tick?.at ?? null} versions={versions} stages={ov.stages} phases={ov.phases}
        footer={<div className="border-t border-zinc-200 p-3"><UserMenu stacked /></div>} />
    }>
      {children}
      <CommandBar pid={id} places={places} agents={agents} stages={stageKeys} versions={versions} />
    </SidebarShell>
  );
}
