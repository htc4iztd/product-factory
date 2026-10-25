"use client";
import { useState, useTransition } from "react";
import { Github } from "lucide-react";
import type { GithubLink } from "@/lib/agent";
import { pushTicket } from "@/app/(app)/p/[id]/team-actions";

export function GithubTicketBox({ pid, n, link, repo }: { pid: string; n: number; link: GithubLink | null; repo: string | null }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  if (!repo && !link) return null;
  return (
    <div className="card space-y-2 p-4 text-[13px]" aria-label="GitHub">
      <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-600"><Github size={13} />GitHub</div>
      {link?.number ? (
        <a href={link.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:underline">
          {link.repo}#{link.number}<span className={`chip ${link.state === "closed" ? "" : "border-emerald-200 text-emerald-700"}`}>{link.state === "closed" ? "closed" : "open"}</span>
        </a>
      ) : (
        <button type="button" disabled={pending} className="btn-secondary btn-sm"
          onClick={() => start(async () => { const r = await pushTicket(pid, n); setErr(r.error ?? null); })}>
          {pending ? "起票中…" : "GitHub に Issue として起票"}
        </button>
      )}
      {(err || link?.error) && <p className="text-xs text-rose-600">同期できません：{err ?? link?.error}</p>}
    </div>
  );
}
