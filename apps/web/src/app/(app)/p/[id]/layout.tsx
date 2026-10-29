import { cookies } from "next/headers";
import { SidebarShell } from "@/components/SidebarShell";
import { agent, type Overview } from "@/lib/agent";
import { UserMenu } from "@/components/UserMenu";
import { AgentRail, type RailAgent } from "@/components/rail/AgentRail";
import { CommandBar } from "@/components/rail/CommandBar";

// プロダクトの画面の枠：左は「人」（エージェント）のレール、どこからでも ⌘K で話しかける・移動する
export default async function ProductLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [ov, team, versions] = await Promise.all([
    agent<Overview>(`/products/${id}`),
    agent<{ agents: RailAgent[] }>(`/products/${id}/team`),
    agent<Record<string, string>>("/avatars").catch(() => ({} as Record<string, string>)),
  ]);
  const navOpen = (await cookies()).get("pf_nav")?.value !== "closed";
  const places = [
    { label: "ダッシュボード", href: `/p/${id}`, hint: "工程とエージェントの状況・司令塔との対話", keys: "dashboard トップ 全体 状況" },
    { label: "掲示板", href: `/p/${id}/board`, hint: "エージェント同士・PdM のやり取り", keys: "board 履歴 やり取り" },
    { label: "エージェントの組織", href: `/p/${id}/team`, hint: "使命・動く時刻・タスク・顔", keys: "team 組織 タスク 顔" },
    { label: "プロダクト・キャンバス", href: `/p/${id}/canvas`, hint: "プロダクトのイメージ画像", keys: "canvas 画像 絵 イメージ" },
    { label: "資料の取り込み", href: `/p/${id}/import`, hint: "Excel・Word・PowerPoint を工程に入れる", keys: "import 取り込み excel word powerpoint" },
    { label: "報告資料", href: `/p/${id}/reports`, hint: "範囲を選んでスライドに", keys: "report 報告 スライド pptx" },
    { label: "定期の仕事", href: `/p/${id}/agents`, hint: "リサーチ更新・報告資料の作り直し", keys: "schedule 定期 cron" },
    { label: "プリプロダクト", href: `/p/${id}/preproducts`, hint: "案（PP-n）と試作", keys: "preproduct 案 試作 パターン" },
    { label: "ジョブ", href: `/jobs?product=${id}`, hint: "動いている処理", keys: "jobs ジョブ" },
    { label: "議論", href: `/p/${id}/talk`, hint: "人どうしの議論", keys: "talk 議論" },
    { label: "チケット", href: `/p/${id}/tickets`, hint: "", keys: "ticket チケット" },
    { label: "決定記録", href: `/p/${id}/decisions`, hint: "", keys: "decision 決定" },
    { label: "会議", href: `/p/${id}/meetings`, hint: "", keys: "meeting 会議 議事録" },
    { label: "ドキュメント", href: `/p/${id}/docs`, hint: "", keys: "docs ドキュメント" },
    { label: "コード（IDE）", href: `/p/${id}/code`, hint: "", keys: "code ide コード" },
    { label: "ステージの設定", href: `/p/${id}/settings`, hint: "", keys: "settings 設定 承認" },
    { label: "監査ログ", href: `/p/${id}/audit`, hint: "", keys: "audit 監査 ログ" },
    ...ov.stages.map((s) => ({ label: `${s.no} ${s.name}`, href: `/p/${id}/s/${s.id}`, hint: `${s.framework}・担当と話す`, keys: `${s.id} ${s.name}` })),
  ];
  const agents = [
    { key: "director", name: "司令塔", keys: "司令塔 司令 director" },
    { key: "pm", name: "PM", keys: "PM pm" },
    ...ov.stages.map((s) => ({ key: s.id, name: `${s.no}${s.name}担当`, keys: `${s.no} ${s.name} ${s.id}` })),
  ];
  return (
    <SidebarShell initialOpen={navOpen} sidebar={
      <AgentRail pid={id} product={ov.product} agents={team.agents} versions={versions} stages={ov.stages} phases={ov.phases}
        footer={<div className="border-t border-zinc-200 p-3"><UserMenu stacked /></div>} />
    }>
      {children}
      <CommandBar pid={id} places={places} agents={agents} versions={versions} />
    </SidebarShell>
  );
}
