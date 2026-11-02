"use client";
import { useEffect, useId, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

let ready: Promise<typeof import("mermaid").default> | null = null;
// Mermaid は使うときだけ読み込む（初期化は1回）。securityLevel は strict（図の中のスクリプト・HTML は動かさない）
function load() {
  ready ??= import("mermaid").then((m) => {
    m.default.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral", fontFamily: "inherit", flowchart: { htmlLabels: false } });
    return m.default;
  });
  return ready;
}

// Mermaid の図。描けなければ、元の記法と理由をそのまま見せる
export function Mermaid({ code }: { code: string }) {
  const id = "m" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    load()
      .then((m) => m.render(id, code))
      .then((r) => { if (alive) { setSvg(r.svg); setErr(null); } })
      .catch((e: unknown) => { if (alive) setErr(e instanceof Error ? e.message.split("\n")[0] : String(e)); });
    return () => { alive = false; };
  }, [code, id]);
  if (err) {
    return (
      <div className="my-2 rounded-lg border border-amber-200 bg-amber-50/50 p-2">
        <div className="mb-1 text-[11px] text-amber-800">図を描けませんでした（{err}）。記法のまま表示します。</div>
        <pre className="overflow-x-auto text-[11.5px]"><code>{code}</code></pre>
      </div>
    );
  }
  if (!svg) return <div className="my-2 h-24 animate-pulse rounded-lg bg-zinc-100" aria-label="図を描いています" />;
  return <div className="my-2 overflow-x-auto rounded-lg border border-zinc-100 bg-white p-2 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full" role="img" aria-label="図" dangerouslySetInnerHTML={{ __html: svg }} />;
}

// Markdown の表示（表・リストなど GFM と、```mermaid の図）
export function Md({ children }: { children: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children: c, ...rest }) {
          if (/language-mermaid/.test(className ?? "")) return <Mermaid code={String(c).replace(/\n$/, "")} />;
          return <code className={className} {...rest}>{c}</code>;
        },
        pre({ children: c, ...rest }) {
          // Mermaid の図は pre で囲まない
          const child = Array.isArray(c) ? c[0] : c;
          if (child && typeof child === "object" && "props" in child && /language-mermaid/.test((child.props as { className?: string }).className ?? "")) return <>{c}</>;
          return <pre {...rest}>{c}</pre>;
        },
      }}
    >
      {children}
    </Markdown>
  );
}
