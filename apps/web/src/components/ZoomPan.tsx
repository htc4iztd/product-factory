"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";

type Box = { x: number; y: number; w: number; h: number };

// SVG の図を拡大・縮小・移動できるようにする。
// ボタン（＋・−・全体）、Ctrl / ⌘ ＋ホイールかピンチで拡大縮小、ドラッグで移動。普通のホイールはページのスクロールに任せる
export function ZoomPan({ width, height, label, className = "", children, maxScale = 6 }: {
  width: number; height: number; label: string; className?: string; children: React.ReactNode; maxScale?: number;
}) {
  const full: Box = { x: 0, y: 0, w: width, h: height };
  const [vb, setVb] = useState<Box>(full);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ px: number; py: number; vb: Box } | null>(null);
  const scale = width / vb.w;

  // 画面上の点（clientX/Y）を、いまの表示の中の座標にする
  const toLocal = useCallback((cx: number, cy: number, b: Box) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: b.x + ((cx - r.left) / r.width) * b.w, y: b.y + ((cy - r.top) / r.height) * b.h };
  }, []);

  const zoom = useCallback((factor: number, at?: { x: number; y: number }) => {
    setVb((b) => {
      const w = Math.min(width, Math.max(width / maxScale, b.w / factor));
      const h = (w / width) * height;
      const c = at ?? { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      // 指した点が同じ場所に残るように寄せる
      const x = c.x - ((c.x - b.x) / b.w) * w;
      const y = c.y - ((c.y - b.y) / b.h) * h;
      return clamp({ x, y, w, h }, width, height);
    });
  }, [width, height, maxScale]);

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return; // 普通のホイールはページのスクロール
      e.preventDefault();
      setVb((b) => {
        const at = toLocal(e.clientX, e.clientY, b);
        const factor = Math.exp(-e.deltaY * 0.01);
        const w = Math.min(width, Math.max(width / maxScale, b.w / factor));
        const h = (w / width) * height;
        return clamp({ x: at.x - ((at.x - b.x) / b.w) * w, y: at.y - ((at.y - b.y) / b.h) * h, w, h }, width, height);
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [toLocal, width, height, maxScale]);

  return (
    <div className={className}>
      <svg ref={svg} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className={`h-auto w-full select-none ${scale > 1 ? "cursor-grab active:cursor-grabbing" : ""}`}
        style={{ touchAction: scale > 1 ? "none" : "pan-y" }} role="img" aria-label={label}
        onPointerDown={(e) => {
          if (scale <= 1 || (e.target as Element).closest("[data-nopan]")) return;
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          drag.current = { px: e.clientX, py: e.clientY, vb };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const r = svg.current!.getBoundingClientRect();
          const dx = ((e.clientX - d.px) / r.width) * d.vb.w, dy = ((e.clientY - d.py) / r.height) * d.vb.h;
          setVb(clamp({ ...d.vb, x: d.vb.x - dx, y: d.vb.y - dy }, width, height));
        }}
        onPointerUp={() => { drag.current = null; }}
        onDoubleClick={() => setVb(full)}>
        {children}
      </svg>
      <div className="mt-1 flex items-center justify-end gap-2" data-nopan>
        {scale > 1 && <span className="text-[10px] text-zinc-500">{Math.round(scale * 100)}%・ドラッグで移動</span>}
        <div className="flex overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm">
        <button type="button" onClick={() => zoom(1.4)} className="p-1.5 text-zinc-600 hover:bg-zinc-100" aria-label="拡大" title="拡大（Ctrl / ⌘ ＋ホイールでも）"><Plus size={13} /></button>
        <button type="button" onClick={() => zoom(1 / 1.4)} className="border-l border-zinc-200 p-1.5 text-zinc-600 hover:bg-zinc-100" aria-label="縮小" title="縮小"><Minus size={13} /></button>
        <button type="button" onClick={() => setVb(full)} className="border-l border-zinc-200 p-1.5 text-zinc-600 hover:bg-zinc-100" aria-label="全体を表示" title="全体を表示（ダブルクリックでも）"><Maximize size={13} /></button>
        </div>
      </div>
    </div>
  );
}

function clamp(b: Box, width: number, height: number): Box {
  return { ...b, x: Math.min(Math.max(0, b.x), width - b.w), y: Math.min(Math.max(0, b.y), height - b.h) };
}

// 文字を、だいたいの幅（全角1・半角0.55）で折り返す。max 行を超えたら最後を「…」にする
export function wrapText(t: string, perLine: number, max: number): { lines: string[]; cut: boolean } {
  const lines: string[] = [];
  let cur = "", w = 0;
  for (const ch of t) {
    const cw = /[\x00-\x7f]/.test(ch) ? 0.55 : 1;
    if (w + cw > perLine && cur) { lines.push(cur); cur = ""; w = 0; }
    cur += ch;
    w += cw;
  }
  if (cur) lines.push(cur);
  if (lines.length <= max) return { lines, cut: false };
  const kept = lines.slice(0, max);
  kept[max - 1] = kept[max - 1].slice(0, Math.max(1, kept[max - 1].length - 1)) + "…";
  return { lines: kept, cut: true };
}

// 文字のだいたいの幅（SVG の単位。fontSize に対して）
export function textWidth(t: string, fontSize: number) {
  let w = 0;
  for (const ch of t) w += /[\x00-\x7f]/.test(ch) ? 0.58 : 1;
  return w * fontSize;
}
