"use client";
import { useEffect, useMemo, useState } from "react";
import type { ResearchData } from "@/lib/agent";
import { buildModel } from "./model";
import { NewsTab } from "./NewsTab";
import { IssuesTab } from "./IssuesTab";
import { ReportsTab } from "./ReportsTab";
import { PlayersTab } from "./PlayersTab";
import { FactsTab } from "./FactsTab";
import { AnalysisTab } from "./AnalysisTab";
import { RunningCtx, type Running } from "@/components/knowledge/ResearchBits";

export const TABS = {
  news: "ニュース", iss: "論点", tech: "技術調査", ind: "業界調査", pub: "公的データ", map: "プレーヤー", facts: "ファクトDB", ana: "データ分析", add: "記事を足す", settings: "設定",
} as const;
export type Tab = keyof typeof TABS;

// リサーチライブラリの画面。絞り込み・集計は画面の側で行い、書き込みはサーバーアクションで行う
export function ResearchApp({ d, canEdit, initial, add, settings, running }: { d: ResearchData; canEdit: boolean; initial: Tab; add: React.ReactNode; settings: React.ReactNode; running: Running }) {
  const [tab, setTab] = useState<Tab>(initial);
  const [factArt, setFactArt] = useState("");
  const M = useMemo(() => buildModel(d), [d]);
  // 選んだ記事は、この端末に覚えておく（パワポに出す前に何度か開き直してもよいように）
  const key = `pf-research-sel-${d.number}`;
  const [sel, setSelState] = useState<Set<string>>(new Set());
  useEffect(() => {
    try { setSelState(new Set(JSON.parse(localStorage.getItem(key) ?? "[]"))); } catch { /* 使えない環境では覚えない */ }
  }, [key]);
  const setSel = (s: Set<string>) => {
    setSelState(s);
    try { localStorage.setItem(key, JSON.stringify([...s])); } catch { /* 同上 */ }
  };
  const go = (t: Tab) => {
    setTab(t);
    const u = new URL(window.location.href);
    u.searchParams.set("tab", t);
    window.history.replaceState(null, "", u.toString());
  };
  const count: Partial<Record<Tab, number>> = {
    news: M.arts.length, iss: M.issues.length, facts: M.facts.length, map: M.players.length,
    tech: d.reports.filter((r) => r.kind === "tech").length, ind: d.reports.filter((r) => r.kind === "industry").length, pub: d.reports.filter((r) => r.kind === "public").length,
  };
  return (
    <RunningCtx.Provider value={running}>
    <div className="space-y-5">
      <nav className="flex gap-1 overflow-x-auto border-b border-zinc-200" role="tablist">
        {(Object.keys(TABS) as Tab[]).filter((k) => canEdit || (k !== "add" && k !== "settings")).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => go(k)}
            className={`shrink-0 border-b-2 px-3 py-2 text-[13px] font-medium ${tab === k ? "border-brand-600 text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-800"} ${k === "add" ? "ml-auto" : ""}`}>
            {TABS[k]}{count[k] ? <span className="ml-1 text-[10px] text-zinc-400">{count[k]}</span> : null}
          </button>
        ))}
      </nav>
      {tab === "news" && <NewsTab n={d.number} d={d} M={M} canEdit={canEdit} sel={sel} setSel={setSel} onFacts={(k) => { setFactArt(k); go("facts"); }} />}
      {tab === "iss" && <IssuesTab n={d.number} d={d} M={M} canEdit={canEdit} />}
      {tab === "tech" && <ReportsTab n={d.number} d={d} kind="tech" label="技術調査" canEdit={canEdit} />}
      {tab === "ind" && <ReportsTab n={d.number} d={d} kind="industry" label="業界調査" canEdit={canEdit} />}
      {tab === "pub" && <ReportsTab n={d.number} d={d} kind="public" label="公的データ" canEdit={canEdit} />}
      {tab === "map" && <PlayersTab n={d.number} d={d} M={M} canEdit={canEdit} />}
      {tab === "facts" && <FactsTab n={d.number} d={d} M={M} canEdit={canEdit} art={factArt} setArt={setFactArt} />}
      {tab === "ana" && <AnalysisTab n={d.number} d={d} M={M} />}
      {tab === "add" && add}
      {tab === "settings" && settings}
    </div>
    </RunningCtx.Provider>
  );
}
