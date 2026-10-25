import Link from "next/link";
import { Fragment } from "react";

// 本文の中の ID（US-01・TK-3・DEC-2 など）を、それぞれの置き場所へのリンクにする
const STAGE_OF: Record<string, string> = { US: "s06", AC: "s06", SC: "s06", FR: "s08", IF: "s08", TC: "s13" };

export function refHref(pid: string, ref: string): string | null {
  const m = /^([A-Z]{2,4})-(\d+)$/.exec(ref);
  if (!m) return null;
  const [, p, n] = m;
  if (STAGE_OF[p]) return `/p/${pid}/s/${STAGE_OF[p]}`;
  if (p === "TK") return `/p/${pid}/tickets/${n}`;
  if (p === "DEC") return `/p/${pid}/decisions#DEC-${n}`;
  if (p === "MTG") return `/p/${pid}/meetings/${n}`;
  if (p === "DOC") return `/p/${pid}/docs/${n}`;
  return null;
}

export function RefText({ pid, text }: { pid: string; text: string }) {
  const parts = text.split(/([A-Z]{2,4}-\d+|@[\w.+-]+@[\w-]+\.[\w.-]+)/g);
  return (
    <>
      {parts.map((part, i) => {
        const href = refHref(pid, part);
        if (href) return <Link key={i} href={href} className="rounded bg-brand-50 px-1 font-mono text-[0.92em] text-brand-700 hover:underline">{part}</Link>;
        if (part.startsWith("@") && part.includes(".")) return <span key={i} className="font-medium text-brand-700">{part}</span>;
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

export function RefChips({ pid, refs }: { pid: string; refs: string[] }) {
  if (!refs.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {refs.map((r) => {
        const href = refHref(pid, r);
        return href
          ? <Link key={r} href={href} className="chip font-mono hover:border-brand-300">{r}</Link>
          : <span key={r} className="chip font-mono">{r}</span>;
      })}
    </span>
  );
}

export function when(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" });
}
