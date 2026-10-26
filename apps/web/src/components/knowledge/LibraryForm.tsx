"use client";
import type { ResearchLibrary } from "@/lib/agent";
import { ActionForm } from "@/components/team/ActionForm";

type Result = { error?: string } | undefined;

// ライブラリの設定。URL・論点・企業は1行に1つ
export function LibraryForm({ action, lib, submit }: { action: (prev: Result, f: FormData) => Promise<Result>; lib?: ResearchLibrary; submit: string }) {
  const area = "input min-h-20 font-mono text-[12px]";
  return (
    <ActionForm action={action} submit={submit} reset={!lib} pendingLabel="保存中…">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-[12px] text-zinc-600 md:col-span-2">名前
          <input name="name" required defaultValue={lib?.name} className="input" placeholder="例：家計管理アプリの市場動向" />
        </label>
        <label className="space-y-1 text-[12px] text-zinc-600 md:col-span-2">何を追うか（AI の検索と抜き出しの手がかり）
          <textarea name="description" defaultValue={lib?.description} className="input min-h-16" placeholder="例：国内外の家計簿・家計管理サービスの利用実態、料金、規制の動き" />
        </label>
        <label className="space-y-1 text-[12px] text-zinc-600 md:col-span-2">AI への指示（任意）
          <textarea name="instructions" defaultValue={lib?.instructions} className="input min-h-12" placeholder="例：一次情報（調査会社・公的統計・各社の発表）を優先する" />
        </label>
        <label className="space-y-1 text-[12px] text-zinc-600">論点（1行に1つ。「論点名｜その論点で問うこと」とも書ける）
          <textarea name="issues" defaultValue={lib?.issues.map((x) => (lib.issue_defs?.[x] ? `${x}｜${lib.issue_defs[x]}` : x)).join("\n")} className={area} placeholder="例：利用の広がり｜どの層がどれくらい使っているか" />
        </label>
        <label className="space-y-1 text-[12px] text-zinc-600">追う企業・団体（1行に1つ）
          <textarea name="entities" defaultValue={lib?.entities.join("\n")} className={area} />
        </label>
        <label className="space-y-1 text-[12px] text-zinc-600">RSS / Atom の URL（1行に1つ）
          <textarea name="feeds" defaultValue={lib?.feeds.join("\n")} className={area} placeholder="https://example.com/feed" />
        </label>
        <label className="space-y-1 text-[12px] text-zinc-600">見に行くページの URL（1行に1つ）
          <textarea name="sites" defaultValue={lib?.sites.join("\n")} className={area} placeholder="https://example.com/news" />
        </label>
        {lib && (
          <>
            <label className="space-y-1 text-[12px] text-zinc-600">プレーヤーの層（1行に1つ。マップの段）
              <textarea name="layers" defaultValue={lib.layers.join("\n")} className={area} />
            </label>
            <label className="space-y-1 text-[12px] text-zinc-600">ファクトのテーマ（1行に1つ）
              <textarea name="topics" defaultValue={lib.topics.join("\n")} className={area} />
            </label>
          </>
        )}
        <label className="space-y-1 text-[12px] text-zinc-600">期間の始まり（空なら、最新の記事の日付から）
          <input type="date" name="since" defaultValue={lib?.since ?? ""} className="input" />
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-[12px] text-zinc-600">
          <input type="checkbox" name="use_search" defaultChecked={lib?.use_search ?? true} />AI の検索で探す（Gemini / Vertex AI の接続のときだけ）
        </label>
      </div>
    </ActionForm>
  );
}
