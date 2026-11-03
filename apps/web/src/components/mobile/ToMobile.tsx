"use client";
import { Smartphone } from "lucide-react";
import { switchView } from "@/lib/mobile";

// スマホで PC 版を見ているときだけ出す：スマホ版に戻す
export function ToMobile() {
  return (
    <button onClick={() => switchView("m")} className="fixed bottom-3 left-3 z-[100] flex items-center gap-1 rounded-full bg-zinc-900 px-3 py-2 text-[12px] text-white shadow-lg">
      <Smartphone size={14} />スマホ版に戻す
    </button>
  );
}
