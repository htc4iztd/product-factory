"use client";
import { useState, useTransition } from "react";
import { Eye } from "lucide-react";
import type { StageSummary } from "@/lib/agent";
import { setDocReaders, setReaders } from "@/app/(app)/p/[id]/org-actions";
import { Avatar } from "@/components/rail/Avatar";

// 資料を、読んでいいエージェントに割り当てる。
// 取り込んだ資料：決めていなければ、割り当てた工程の担当と、その領域の PM。手で書いたドキュメント（DOC-n）：決めていなければ全員
export function ReadersEditor({ pid, doc, readers, custom, stages, versions, kind = "import" }: {
  pid: string; doc: number; readers: string[]; custom: boolean; stages: StageSummary[]; versions: Record<string, string>; kind?: "import" | "doc";
}) {
  const save = kind === "doc" ? setDocReaders : setReaders;
  const fallback = kind === "doc" ? "既定（全員）" : "既定（割り当てた工程の担当と、その領域の PM）";
  const [sel, setSel] = useState<string[]>(readers);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty = sel.slice().sort().join() !== readers.slice().sort().join();
  const all = [{ key: "pm_biz", name: "事業PM" }, { key: "pm_design", name: "設計PM" }, { key: "pm_impl", name: "実装PM" },
    ...stages.map((s) => ({ key: s.id, name: `${s.no}${s.name}` }))];
  return (
    <div className="card space-y-2 p-5" aria-label="読んでいいエージェント">
      <div className="flex flex-wrap items-center gap-2">
        <Eye size={15} className="text-brand-600" />
        <h3 className="text-[14px] font-semibold">{kind === "doc" ? "このドキュメント" : "この資料"}を読んでいいエージェント</h3>
        <span className="text-[11px] text-zinc-500">{custom ? "割り当て済み" : fallback}・{sel.length}人</span>
        <span className="ml-auto flex gap-1.5">
          <button className="btn-ghost btn-sm" onClick={() => setSel(all.map((a) => a.key))}>全員</button>
          <button className="btn-ghost btn-sm" onClick={() => setSel([])}>誰にも読ませない</button>
          <button className="btn-primary btn-sm" disabled={!dirty || pending}
            onClick={() => start(async () => { const r = await save(pid, doc, sel); setMsg(r.error ?? "保存しました。次に動くとき・話すときから読みます"); })}>保存</button>
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {all.map((a) => {
          const on = sel.includes(a.key);
          return (
            <button key={a.key} type="button" aria-pressed={on} onClick={() => setSel((x) => (on ? x.filter((y) => y !== a.key) : [...x, a.key]))}
              className={`flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-[12px] transition ${on ? "border-brand-400 bg-brand-50 text-brand-800" : "border-zinc-200 text-zinc-500 opacity-70 hover:opacity-100"}`}>
              <Avatar k={a.key} v={versions[a.key]} size={22} state={on ? "idle" : "off"} />{a.name}
            </button>
          );
        })}
      </div>
      {msg && <p className="text-[11px] text-zinc-500">{msg}</p>}
    </div>
  );
}
