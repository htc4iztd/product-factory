"use client";
import { useState } from "react";
import type { Row } from "@/lib/agent";
import { ZoomPan, textWidth, wrapText } from "@/components/ZoomPan";

// ---------- ② 市場規模：円の中は TAM / SAM / SOM の名前だけ。値は右に引き出し線つきで書き、長ければ折り返す ----------
export function Circles({ rows }: { rows: Row[] }) {
  const by = Object.fromEntries(rows.map((r) => [String(r.tier), r]));
  const ring = [
    { k: "TAM", r: 96, fill: "#eef0fe", text: "#4547c4", ang: -40, ly: 22 },
    { k: "SAM", r: 66, fill: "#dfe2fc", text: "#4547c4", ang: -15, ly: 92 },
    { k: "SOM", r: 36, fill: "#6366f1", text: "#ffffff", ang: 10, ly: 150 },
  ];
  const cx = 104, base = 214, lx = 228;
  return (
    <svg viewBox="0 0 380 220" className="mx-auto w-full max-w-[420px]" role="img" aria-label="TAM SAM SOM">
      {ring.map((x) => <circle key={x.k} cx={cx} cy={base - x.r} r={x.r} fill={x.fill} stroke="#c9cdf7" />)}
      {ring.map((x, i) => (
        <text key={x.k + "n"} x={cx} y={base - 2 * x.r + (i === 2 ? 40 : 18)} textAnchor="middle" fontSize="11" fontWeight="700" fill={x.text}>{x.k}</text>
      ))}
      {ring.map((x) => {
        const value = String(by[x.k]?.value ?? "").trim() || "—";
        const { lines } = wrapText(value, 13, 3); // 入りきらない分は「…」。全文は触れると出る（title）と右の表
        const a = (x.ang * Math.PI) / 180;
        const px = cx + x.r * Math.cos(a), py = base - x.r + x.r * Math.sin(a);
        return (
          <g key={x.k + "v"}>
            <title>{`${x.k}：${value}`}</title>
            <polyline points={`${px},${py} ${lx - 8},${x.ly + 4} ${lx - 2},${x.ly + 4}`} fill="none" stroke="#a5a8f0" strokeWidth="1" />
            <circle cx={px} cy={py} r="2" fill="#6366f1" />
            <text x={lx} y={x.ly + 8} fontSize="10" fontWeight="700" fill="#4547c4">{x.k}</text>
            {lines.map((l, j) => <text key={j} x={lx} y={x.ly + 22 + j * 13} fontSize="10" fill="#3f3f46">{l}</text>)}
          </g>
        );
      })}
    </svg>
  );
}

// ---------- ③ ポジショニングマップ：軸の名前は図の外に全文。点の名前は端なら内側に寄せ、重なればずらす。長い名前は吹き出しで全文 ----------
const W = 360, H = 400, L = 20, T = 40, S = 320; // 図の枠：左上 (L, T)、一辺 S

export function PositionMap({ rows, x, y }: { rows: Row[]; x: string; y: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const pts = rows.filter((r) => String(r.name ?? "").trim()).map((r, i) => {
    const v = (n: unknown) => Math.max(-5, Math.min(5, Number(n) || 0));
    const name = String(r.name);
    return { i, name, px: L + S / 2 + v(r.x) * (S / 2 - 14) / 5, py: T + S / 2 - v(r.y) * (S / 2 - 14) / 5, self: /自社|当社|us|self/i.test(name) };
  });
  // 名前の置き場所：右半分の右寄りなら点の左、そうでなければ右。近い名前どうしは縦にずらす
  const labels = pts.map((p) => {
    const short = p.name.length > 12 ? p.name.slice(0, 11) + "…" : p.name;
    const left = p.px > L + S - 4 - textWidth(short, 10) - 12;
    return { ...p, short, left, ly: p.py + 3.5 };
  }).sort((a, b) => a.ly - b.ly);
  for (let i = 1; i < labels.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = labels[j], b = labels[i];
      if (Math.abs(a.ly - b.ly) < 12 && Math.abs(a.px - b.px) < 90 && a.left === b.left) b.ly = a.ly + 12;
    }
  }
  const xl = wrapText(`横軸 → ${x || "（未設定）"}`, 31, 2), yl = wrapText(`縦軸 ↑ ${y || "（未設定）"}`, 31, 2);
  const cur = hover == null ? null : pts.find((p) => p.i === hover);
  return (
    <ZoomPan width={W} height={H} label="ポジショニングマップ">
      <rect x={L} y={T} width={S} height={S} rx="12" fill="#fafafa" stroke="#e4e4e7" />
      <line x1={L + 10} y1={T + S / 2} x2={L + S - 10} y2={T + S / 2} stroke="#d4d4d8" />
      <line x1={L + S / 2} y1={T + 10} x2={L + S / 2} y2={T + S - 10} stroke="#d4d4d8" />
      {yl.lines.map((l, j) => <text key={j} x={L} y={14 + j * 12} fontSize="10" fill="#52525b">{l}<title>{y}</title></text>)}
      {xl.lines.map((l, j) => <text key={j} x={L} y={T + S + 18 + j * 12} fontSize="10" fill="#52525b">{l}<title>{x}</title></text>)}
      {labels.map((p) => (
        <g key={p.i} onPointerEnter={() => setHover(p.i)} onPointerLeave={() => setHover(null)} className="cursor-default" data-nopan>
          {Math.abs(p.ly - (p.py + 3.5)) > 1 && <line x1={p.px} y1={p.py} x2={p.left ? p.px - 8 : p.px + 8} y2={p.ly - 3} stroke="#d4d4d8" />}
          <circle cx={p.px} cy={p.py} r={p.self ? 7 : 5} fill={p.self ? "#6366f1" : "#a1a1aa"} stroke="#fff" strokeWidth="2" />
          <text x={p.left ? p.px - 10 : p.px + 10} y={p.ly} textAnchor={p.left ? "end" : "start"} fontSize="10"
            fontWeight={p.self ? 700 : 400} fill={p.self ? "#4547c4" : "#3f3f46"}>{p.short}</text>
        </g>
      ))}
      {cur && <Callout x={cur.px} y={cur.py} text={cur.name} />}
    </ZoomPan>
  );
}

// 吹き出し：全文を枠の中に収まる向きで出す
function Callout({ x, y, text }: { x: number; y: number; text: string }) {
  const { lines } = wrapText(text, 18, 4);
  const w = Math.max(...lines.map((l) => textWidth(l, 10))) + 16, h = lines.length * 13 + 10;
  const bx = Math.min(Math.max(4, x - w / 2), W - w - 4);
  const above = y - h - 14 > 4;
  const by = above ? y - h - 12 : y + 12;
  return (
    <g pointerEvents="none">
      <rect x={bx} y={by} width={w} height={h} rx="6" fill="#18181b" opacity="0.92" />
      <path d={above ? `M${x - 5},${by + h} L${x},${by + h + 6} L${x + 5},${by + h} Z` : `M${x - 5},${by} L${x},${by - 6} L${x + 5},${by} Z`} fill="#18181b" opacity="0.92" />
      {lines.map((l, j) => <text key={j} x={bx + 8} y={by + 16 + j * 13} fontSize="10" fill="#fff">{l}</text>)}
    </g>
  );
}
