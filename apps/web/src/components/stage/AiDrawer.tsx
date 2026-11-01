"use client";
import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookOpen, ListChecks, PanelRightClose, Sparkles } from "lucide-react";
import type { ChatMsg, ChatSession, FieldSpec, StageDetail, StageReport } from "@/lib/agent";
import { ChatPanel } from "./ChatPanel";
import { PmChat } from "@/components/org/PmChat";
import type { PmKey, PmMessageT } from "@/lib/agent";

type Tab = "ai" | "props" | "ref";

function References({ refs, onClose }: { refs: StageDetail["references"]; onClose: () => void }) {
  const [sel, setSel] = useState(refs[0]?.id ?? "");
  const cur = refs.find((r) => r.id === sel) ?? refs[0];
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-800 text-white"><BookOpen size={13} /></div>
        <div className="text-[13px] font-semibold">事業フェーズの成果物と決定記録</div>
        <button onClick={onClose} className="btn-ghost btn-sm ml-auto h-7 w-7 p-0" aria-label="パネルを閉じる"><PanelRightClose size={15} /></button>
      </div>
      {refs.length === 0 ? (
        <p className="p-4 text-[13px] text-zinc-500">参照できる成果物がありません。</p>
      ) : (
        <>
          <div className="flex gap-1.5 overflow-x-auto border-b border-zinc-200 px-3 py-2 [scrollbar-width:none]">
            {refs.map((r) => (
              <button key={r.id} onClick={() => setSel(r.id)}
                className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-medium ${cur?.id === r.id ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-200/60"}`}>
                {r.no} {r.name}
              </button>
            ))}
          </div>
          {cur && (
            <div className="flex-1 overflow-y-auto px-4 py-3">
              <div className="mb-2 flex items-center gap-2 text-[11px] text-zinc-500">
                <span>{cur.framework}</span>
                <span className={`chip ${cur.source === "下書き" ? "border-amber-200 text-amber-700" : "border-emerald-200 text-emerald-700"}`}>{cur.source}</span>
                <a href={cur.id === "_decisions" ? "../decisions" : `../s/${cur.id}`} className="ml-auto text-brand-700 hover:underline">開く</a>
              </div>
              <div className="prose-md text-[12px]"><Markdown remarkPlugins={[remarkGfm]}>{cur.markdown}</Markdown></div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// 右側のパネル（AIタブと参照タブ）。開閉と選んだタブは cookie に残す（ステージを移っても保つ）
export function AiDrawer(props: {
  initial: "closed" | Tab; pid: string; sid: string; chat: ChatMsg[]; fields: FieldSpec[]; prompts: string[];
  disabled?: string | null; references: StageDetail["references"]; decisions?: StageDetail["decisions"];
  sessions: ChatSession[]; sessionId: string | null; report: StageReport | null; agent?: StageDetail["agent"];
  pmMessages?: PmMessageT[]; versions?: Record<string, string>;
}) {
  const { initial, decisions = [], references: base, pmMessages = [], versions = {}, ...panel } = props;
  const pm = (panel.agent?.pm ?? "pm_biz") as PmKey;
  // 確定した決定記録（このステージ宛て・下書きの ID に触れるもの）も参照タブに並べる
  const references = decisions.length ? [...base, {
    id: "_decisions", no: "", name: `決定記録（${decisions.length}）`, framework: "会話・会議で確定したこと", status: "", source: "確定",
    markdown: decisions.map((d) => `### ${d.key} ${d.title}\n${d.detail && d.detail !== d.title ? d.detail + "\n" : ""}${d.rationale ? `\n理由：${d.rationale}\n` : ""}${d.refs.length ? `\n関係：${d.refs.join(", ")}\n` : ""}`).join("\n"),
  }] : base;
  const [state, setState] = useState<"closed" | Tab>(initial);
  const set = (v: "closed" | Tab) => {
    setState(v);
    document.cookie = `pf_ai=${v}; path=/; max-age=31536000; samesite=lax`;
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== "]" || e.metaKey || e.ctrlKey || e.altKey || t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      e.preventDefault();
      set(state === "closed" ? "ai" : "closed");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const pending = panel.chat.reduce((n, m) => n + m.proposals.filter((p) => p.status === "pending").length, 0);
  const tabBtn = (t: Tab, icon: React.ReactNode, label: string, badge?: number) => (
    <button onClick={() => set(state === t ? "closed" : t)} title={`${label}（${t === "ai" ? "]" : "クリック"}）`} aria-label={`${label}タブ`}
      className={`flex w-full flex-col items-center gap-1.5 py-3 ${state === t ? "bg-white text-brand-700" : "text-zinc-500 hover:bg-white hover:text-zinc-900"}`}>
      {icon}
      <span className="text-[11px] font-semibold [writing-mode:vertical-rl]">{label}</span>
      {badge ? <span className="rounded-full bg-brand-600 px-1.5 text-[10px] font-semibold text-white" title="未処理の案">{badge}</span> : null}
    </button>
  );

  return (
    <div className="flex shrink-0 border-l border-zinc-200 bg-zinc-50/60">
      {state !== "closed" && (
        <aside className="w-[400px] border-r border-zinc-200">
          {state === "ai" ? (
            <div className="flex h-full flex-col">
              <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
                <div className="text-[13px] font-semibold">この領域の PM と話す</div>
                <span className="ml-auto text-[11px] text-zinc-400">担当には PM が Issue で伝えます</span>
                <button onClick={() => set("closed")} className="btn-ghost btn-sm h-7 w-7 p-0" aria-label="AIタブを閉じる"><PanelRightClose size={15} /></button>
              </div>
              <PmChat pid={panel.pid} messages={pmMessages} versions={versions} pm={pm} stageId={panel.sid} title={false} height="min-h-0" />
            </div>
          ) : state === "props"
            ? <ChatPanel {...panel} onClose={() => set("closed")}
                disabled={panel.disabled ?? "担当エージェントとは直接話せません。伝えたいことは「PM」タブで PM に話してください。ここでは届いた案の採用・却下ができます。"} />
            : <References refs={references} onClose={() => set("closed")} />}
        </aside>
      )}
      <nav className="w-11 divide-y divide-zinc-200">
        {tabBtn("ai", <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-brand-500 to-violet-500 text-white"><Sparkles size={14} /></span>, "PM")}
        {tabBtn("props", <span className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-600 text-white"><ListChecks size={14} /></span>, "案", pending)}
        {tabBtn("ref", <span className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-800 text-white"><BookOpen size={14} /></span>, "参照")}
      </nav>
    </div>
  );
}
