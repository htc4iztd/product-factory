"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Feed } from "@/components/assistant/AssistantShell";
import { useMobile } from "./MobileShell";

export type Tab = "chat" | "approve" | "progress";

// ホーム（ファクトリー全体・プロダクト）：上で チャット｜承認｜進捗 を切り替える。入力欄はどれを選んでいても下にある
export function MobileHome({ progressLabel, progress }: { progressLabel: string; progress: React.ReactNode }) {
  const { msgs, pending, replace } = useMobile();
  const sp = useSearchParams();
  const path = usePathname();
  const router = useRouter();
  const tab = (["chat", "approve", "progress"].includes(sp.get("tab") ?? "") ? sp.get("tab") : "chat") as Tab;
  // 承認タブで答えたものは、タブを離れるまで結果ごと残す（消えると答えが見えない）
  const [kept, setKept] = useState<number[]>([]);
  const waiting = msgs.filter((m) => m.actions.some((a) => a.status === "pending") || kept.includes(m.id));
  const go = (t: Tab) => { setKept([]); router.replace(t === "chat" ? path : `${path}?tab=${t}`, { scroll: false }); };
  const seg = (t: Tab, label: React.ReactNode) => (
    <button role="tab" aria-selected={tab === t} onClick={() => go(t)}
      className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[13px] ${tab === t ? "bg-white font-semibold text-zinc-900 shadow-sm" : "text-zinc-500"}`}>{label}</button>
  );
  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-10 bg-white px-3 py-2">
        <div className="flex rounded-xl bg-zinc-100 p-1" role="tablist" aria-label="表示">
          {seg("chat", "チャット")}
          {seg("approve", <>承認{pending > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-semibold text-white">{pending}</span>}</>)}
          {seg("progress", progressLabel)}
        </div>
      </div>
      {tab === "chat" && <Feed msgs={msgs} onChanged={replace} />}
      {tab === "approve" && (waiting.length ? <Feed msgs={waiting} onChanged={(m) => { setKept((k) => [...k, m.id]); replace(m); }} />
        : <p className="px-5 py-10 text-center text-[13px] text-zinc-400">承認待ちはありません。エージェントが何かを変えるときは、ここに承認依頼が届きます。</p>)}
      {tab === "progress" && <div className="px-3 pb-6">{progress}</div>}
    </div>
  );
}

export function Row({ href, title, sub, right }: { href: string; title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <Link href={href} className="flex items-center gap-3 border-b border-zinc-100 px-2 py-3 active:bg-zinc-50">
      <div className="min-w-0 flex-1"><div className="truncate text-[14.5px] font-medium">{title}</div>{sub && <div className="truncate text-[12px] text-zinc-500">{sub}</div>}</div>
      {right}<span className="text-zinc-300">›</span>
    </Link>
  );
}
