"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { ExternalLink, Github, RefreshCw } from "lucide-react";
import type { GithubSyncOne, GithubSyncStatus, IssueGithub } from "@/lib/agent";
import { syncAllGithub, syncIssueGithub } from "@/app/(app)/p/[id]/github-actions";

const at = (t: string | null) => (t ? new Date(t).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

function said(r: GithubSyncOne): string {
  if (r.created) return `GitHub に #${r.github_number} を作りました${r.pushed ? `（記録 ${r.pushed} 件をコメントで送りました）` : ""}`;
  const parts = [r.pulled && `GitHub のコメント ${r.pulled} 件を取り込みました`, r.state_from === "github" && "GitHub での開閉を反映しました",
    r.pushed && `記録 ${r.pushed} 件を送りました`].filter(Boolean);
  return parts.length ? parts.join("・") : "変わったことはありませんでした（題名・本文・状態はそろえました）";
}

// Issue ごとの GitHub との同期。自動では動かない（押したときだけ）
export function IssueGithubPanel({ pid, number, github }: { pid: string; number: number; github: IssueGithub | null | undefined }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2 border-t border-zinc-100 pt-3 text-[12.5px]" aria-label="GitHub との同期">
      <div className="flex items-center gap-1.5 font-semibold text-zinc-700"><Github size={14} />GitHub</div>
      {github ? (
        <div className="space-y-0.5 text-zinc-600">
          <a href={github.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-brand-700 hover:underline">
            {github.repo} #{github.number}<ExternalLink size={11} />
          </a>
          <div>GitHub 側：{github.state === "closed" ? "閉じている" : "開いている"}・最後に同期：{at(github.synced_at)}</div>
          {github.error && <div className="text-rose-600">前回の失敗：{github.error}</div>}
        </div>
      ) : <p className="text-zinc-500">まだ GitHub とつないでいません。押すと GitHub に Issue を作ります。</p>}
      <button className="btn-secondary btn-sm w-full justify-center" disabled={pending}
        onClick={() => start(async () => { const r = await syncIssueGithub(pid, number); setMsg(r.error ?? (r.result ? said(r.result) : null)); })}>
        <RefreshCw size={12} className={pending ? "animate-spin" : ""} />{pending ? "同期中…" : github ? "GitHub と同期" : "GitHub に送る"}
      </button>
      {msg && <p className="text-[11.5px] text-zinc-600" role="status">{msg}</p>}
      <p className="text-[11px] text-zinc-400">押したときだけ動きます。GitHub のコメントと開閉を取り込み、こちらの記録・状態を送ります。</p>
    </div>
  );
}

// 一覧の上：つないだ Issue をまとめて同期する
export function GithubSyncBar({ pid, status }: { pid: string; status: GithubSyncStatus }) {
  const [all, setAll] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!status.repo) {
    return <p className="flex items-center gap-1.5 text-[12px] text-zinc-500"><Github size={13} />GitHub と同期するには、先に<Link href={`/p/${pid}/code`} className="text-brand-700 hover:underline">コード</Link>でリポジトリをつなぎます。</p>;
  }
  if (status.token === "none") {
    return <p className="flex items-center gap-1.5 text-[12px] text-zinc-500"><Github size={13} />{status.repo} と同期するには、<Link href="/settings" className="text-brand-700 hover:underline">設定</Link>で GitHub のトークンを入れます。</p>;
  }
  const n = status.linked + (all ? status.open_unlinked : 0);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[12px]" aria-label="GitHub との同期">
      <Github size={14} className="text-zinc-600" />
      <span className="font-medium">{status.repo}</span>
      <span className="text-zinc-500">つないだ Issue {status.linked} 件・最後に同期 {at(status.synced_at)}</span>
      <label className="ml-auto flex items-center gap-1 text-zinc-600">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />まだつないでいない、開いている Issue（{status.open_unlinked} 件）も送る
      </label>
      <button className="btn-secondary btn-sm" disabled={pending || n === 0}
        onClick={() => start(async () => {
          const r = await syncAllGithub(pid, all);
          if (r.error) return setMsg(r.error);
          const d = r.result!;
          const made = d.done.filter((x) => x.created).length, pulled = d.done.reduce((a, x) => a + x.pulled, 0), pushed = d.done.reduce((a, x) => a + x.pushed, 0);
          setMsg(`${d.done.length} 件を同期しました（新しく作成 ${made}・取り込んだコメント ${pulled}・送った記録 ${pushed}）` + (d.errors.length ? `。失敗 ${d.errors.length} 件：${d.errors.map((e) => `#${e.number} ${e.error}`).join("／")}` : ""));
        })}>
        <RefreshCw size={12} className={pending ? "animate-spin" : ""} />{pending ? "同期中…" : `今すぐ同期（${n} 件）`}
      </button>
      {msg && <p className="w-full text-[11.5px] text-zinc-600" role="status">{msg}</p>}
    </div>
  );
}
