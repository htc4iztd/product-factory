"use client";
import Link from "next/link";
import { ChevronLeft, Monitor } from "lucide-react";
import { switchView } from "@/lib/mobile";

// 全画面の表示の見出し：戻る・題・PC 版で開く
export function SubHeader({ back, title, sub, pc = true }: { back: string; title: string; sub?: React.ReactNode; pc?: boolean }) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-1 border-b border-zinc-100 bg-white/95 px-1 py-1.5 backdrop-blur">
      <Link href={back} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg active:bg-zinc-100" aria-label="戻る"><ChevronLeft size={20} /></Link>
      <div className="min-w-0 flex-1"><div className="truncate text-[15px] font-semibold">{title}</div>{sub && <div className="truncate text-[11.5px] text-zinc-500">{sub}</div>}</div>
      {pc && <button className="flex h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-[12px] text-zinc-500 active:bg-zinc-100" onClick={() => switchView("pc")} aria-label="PC 版で開く"><Monitor size={14} />PC 版</button>}
    </div>
  );
}

// スマホでは作らない画面：PC 版で開くか、下の入力欄で頼む
export function PcOnly({ back }: { back: string }) {
  return (
    <div>
      <SubHeader back={back} title="PC 向けの画面です" pc={false} />
      <div className="space-y-3 px-5 py-8 text-[14px] text-zinc-600">
        <p>この画面は細かい編集のための画面なので、スマホ版にはありません。</p>
        <p>変えたいことは、下の入力欄で頼めます（承認すると反映されます）。この画面をそのまま使うときは PC 版で開きます。</p>
        <button className="btn-secondary w-full justify-center py-2.5" onClick={() => switchView("pc")}><Monitor size={15} />PC 版で開く</button>
      </div>
    </div>
  );
}
