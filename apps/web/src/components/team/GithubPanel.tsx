"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Github, RefreshCw } from "lucide-react";
import type { GithubStatus } from "@/lib/agent";
import { configureGithub, syncGithub } from "@/app/(app)/p/[id]/team-actions";
import { when } from "./RefText";

const MODES = { off: "同期しない", build: "⑫⑬（構築）のチケットだけ", all: "すべてのチケット" } as const;

// チケット画面の GitHub 連携。開いたときに前回から1分以上たっていれば、GitHub の変更を取り込む
export function GithubPanel({ pid, status: st }: { pid: string; status: GithubStatus }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const auto = useRef(false);

  function sync(quiet = false) {
    start(async () => {
      const r = await syncGithub(pid);
      if (r.error) setMsg({ ok: false, text: r.error });
      else {
        if (!quiet || r.updated || r.created || r.comments) setMsg({ ok: true, text: `取り込みました（更新 ${r.updated}・新規 ${r.created}・コメント ${r.comments}）` });
        router.refresh();
      }
    });
  }
  useEffect(() => {
    if (auto.current || st.sync === "off" || !st.repo) return;
    auto.current = true;
    const last = st.synced_at ? Date.parse(st.synced_at) : 0;
    if (Date.now() - last > 60_000) sync(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function configure(sync: string, importNew: boolean) {
    start(async () => {
      const r = await configureGithub(pid, sync, importNew);
      setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: "保存しました" });
      router.refresh();
    });
  }

  if (!st.repo) {
    return (
      <div className="card flex items-center gap-2 p-3 text-xs text-zinc-500">
        <Github size={14} />GitHub Issues と同期するには、先に <Link href={`/p/${pid}/code`} className="text-brand-700 hover:underline">コード（IDE）</Link> でリポジトリをつないでください。
      </div>
    );
  }
  return (
    <section aria-label="GitHub 連携" className="card flex flex-wrap items-center gap-3 p-3 text-xs">
      <span className="flex items-center gap-1.5 font-medium"><Github size={14} />{st.repo}</span>
      <label className="flex items-center gap-1.5">
        <span className="text-zinc-500">Issues と同期</span>
        <select aria-label="Issues と同期" value={st.sync} disabled={pending} onChange={(e) => configure(e.target.value, st.import)} className="input h-7 w-auto py-0 text-xs">
          {Object.entries(MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      {st.sync !== "off" && (
        <>
          <label className="flex items-center gap-1.5 text-zinc-600">
            <input type="checkbox" checked={st.import} disabled={pending} onChange={(e) => configure(st.sync, e.target.checked)} />
            GitHub で作られた Issue もチケットにする
          </label>
          <button type="button" onClick={() => sync()} disabled={pending} className="btn-secondary btn-sm"><RefreshCw size={12} className={pending ? "animate-spin" : ""} />今すぐ取り込む</button>
          {st.synced_at && <span className="text-zinc-400">最終：{when(st.synced_at)}</span>}
        </>
      )}
      {st.token.source === "none" && <span className="text-amber-700">トークンが未設定です（<Link href="/settings" className="underline">設定</Link>）。公開リポジトリでも書き込みにはトークンが要ります。</span>}
      {msg && <span className={msg.ok ? "text-emerald-600" : "text-rose-600"}>{msg.text}</span>}
    </section>
  );
}
