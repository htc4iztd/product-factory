"use client";
import { useState, useTransition } from "react";
import { Eye } from "lucide-react";
import type { StageSummary } from "@/lib/agent";
import { setReaders } from "@/app/(app)/p/[id]/org-actions";
import { Avatar } from "@/components/rail/Avatar";

// 取り込んだ資料を、読んでいいエージェントに割り当てる（決めていなければ、割り当てた工程の担当と司令塔・PM）
export function ReadersEditor({ pid, doc, readers, custom, stages, versions }: {
  pid: string; doc: number; readers: string[]; custom: boolean; stages: StageSummary[]; versions: Record<string, string>;
}) {
  const [sel, setSel] = useState<string[]>(readers);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty = sel.slice().sort().join() !== readers.slice().sort().join();
  const all = [{ key: "director", name: "司令塔" }, { key: "pm", name: "PM" }, ...stages.map((s) => ({ key: s.id, name: `${s.no}${s.name}` }))];
  return (
    <div className="card space-y-2 p-5" aria-label="読んでいいエージェント">
      <div className="flex flex-wrap items-center gap-2">
        <Eye size={15} className="text-brand-600" />
        <h3 className="text-[14px] font-semibold">この資料を読んでいいエージェント</h3>
        <span className="text-[11px] text-zinc-500">{custom ? "割り当て済み" : "既定（割り当てた工程の担当と司令塔・PM）"}・{sel.length}人</span>
        <span className="ml-auto flex gap-1.5">
          <button className="btn-ghost btn-sm" onClick={() => setSel(all.map((a) => a.key))}>全員</button>
          <button className="btn-ghost btn-sm" onClick={() => setSel([])}>誰にも読ませない</button>
          <button className="btn-primary btn-sm" disabled={!dirty || pending}
            onClick={() => start(async () => { const r = await setReaders(pid, doc, sel); setMsg(r.error ?? "保存しました。次に動くとき・話すときから読みます"); })}>保存</button>
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
