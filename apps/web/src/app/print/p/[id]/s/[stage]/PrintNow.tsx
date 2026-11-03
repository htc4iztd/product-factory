"use client";
import { useEffect, useState } from "react";

// 図を描き終えるのを少し待ってから、印刷（PDF に保存）の画面を開く
export function PrintNow() {
  const [shown, setShown] = useState(true);
  useEffect(() => { const t = setTimeout(() => window.print(), 1200); return () => clearTimeout(t); }, []);
  if (!shown) return null;
  return (
    <div className="mb-6 flex items-center gap-3 rounded-lg bg-zinc-100 px-4 py-2.5 text-[12.5px] text-zinc-700 print:hidden">
      印刷の画面で「PDF に保存」を選ぶと、PDF になります。
      <button className="btn-secondary btn-sm ml-auto" onClick={() => window.print()}>もう一度開く</button>
      <button className="btn-ghost btn-sm" onClick={() => setShown(false)}>閉じる</button>
    </div>
  );
}
