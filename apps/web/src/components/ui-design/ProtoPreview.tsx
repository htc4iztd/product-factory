import Link from "next/link";
import { withBridge } from "@/lib/protoBridge";

// UI のプロトタイプの下見（縮めて表示。押すとプロトタイプを開いて触れる）。⑥の工程・プロダクトレビューで使う
export function ProtoPreview({ pid, html, height = 320 }: { pid: string; html: string; height?: number }) {
  const scale = 0.5;
  return (
    <Link href={`/p/${pid}/s/s06/ui`} className="group block overflow-hidden rounded-lg border border-zinc-200 hover:border-brand-300" aria-label="UI のプロトタイプを開く">
      <div className="relative overflow-hidden bg-white" style={{ height }}>
        <iframe title="UI のプロトタイプの下見" sandbox="allow-scripts" srcDoc={withBridge(html)} tabIndex={-1}
          className="pointer-events-none absolute left-0 top-0 origin-top-left border-0" style={{ width: `${100 / scale}%`, height: height / scale, transform: `scale(${scale})` }} />
      </div>
      <div className="border-t border-zinc-100 px-3 py-1.5 text-[12px] text-zinc-600 group-hover:text-brand-700">開いて触る・コメントする ›</div>
    </Link>
  );
}
