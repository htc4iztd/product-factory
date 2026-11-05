"use client";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { AlertTriangle, ArrowDownToLine, Check, Code2, FileCode2, GitCommitHorizontal, Github, Loader2, RefreshCw, UploadCloud } from "lucide-react";
import { importWorkspace, overwriteWorkspace, pushWorkspace, type WsCommit, type WsView } from "@/app/(app)/p/[id]/code/actions";

const when = (t: string | null) => (t ? new Date(t).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const OP: Record<string, { label: string; tone: string }> = { add: { label: "追加", tone: "text-emerald-700" }, modify: { label: "変更", tone: "text-sky-700" }, delete: { label: "削除", tone: "text-rose-700" } };
type Tab = "diff" | "files" | "ide";

// 開発：エージェントが作業場に書いているコードを見る。上に GitHub への写しの状態、タブは「変更」（記録を選んで差分）と「IDE」（作業場か GitHub か）
export function DevRoom({ pid, initial, ide, canSync }: { pid: string; initial: WsView; ide: boolean; canSync: boolean }) {
  const [v, setV] = useState(initial);
  const [sel, setSel] = useState<number | null>(initial.commits[0]?.number ?? null);
  const [tab, setTab] = useState<Tab>(initial.commits.length ? "diff" : "ide");
  const [src, setSrc] = useState<"workspace" | "github">("workspace");
  const load = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    const r = await fetch(`/api/p/${pid}/workspace`, { cache: "no-store" }).catch(() => null);
    if (r?.ok) setV(await r.json());
  }, [pid]);
  useEffect(() => { const t = setInterval(load, 6000); return () => clearInterval(t); }, [load]);
  // 新しい記録が増えたら、最新を見ていたときは最新に合わせる
  const latest = v.commits[0]?.number ?? null;
  const [follow, setFollow] = useState(true);
  useEffect(() => { if (follow && latest !== null) setSel(latest); }, [latest, follow]);
  const idx = v.commits.findIndex((c) => c.number === sel);
  const pick = (n: number | null) => { setSel(n); setFollow(n === latest); };
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white" aria-label="開発">
      <SyncBar pid={pid} v={v} canSync={canSync} onChanged={load} />
      <div className="flex flex-wrap items-center gap-1 border-b border-zinc-200 px-3 py-1.5 text-[12.5px]">
        <span role="tablist" className="flex gap-1">
          {([["diff", `変更（${v.commits.length}）`, GitCommitHorizontal], ["ide", "IDE", Code2]] as const).map(([k, l, I]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`flex items-center gap-1 rounded-md px-2.5 py-1 ${tab === k ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}><I size={13} />{l}</button>
          ))}
        </span>
        {tab === "diff" && v.commits.length > 0 && (
          <span className="ml-2 flex min-w-0 flex-1 items-center gap-1">
            <button className="btn-ghost btn-sm h-7 px-1.5" disabled={idx >= v.commits.length - 1} onClick={() => pick(v.commits[idx + 1]?.number ?? sel)} aria-label="ひとつ前の変更" title="ひとつ前の変更">‹</button>
            <select className="input h-7 min-w-0 flex-1 py-0 text-[12px]" value={sel ?? ""} onChange={(e) => pick(Number(e.target.value))} aria-label="変更の記録">
              {v.commits.map((c) => <option key={c.number} value={c.number}>#{c.number}{c.unit ? ` ${c.unit}` : ""}　{c.message.slice(0, 60)}（{c.author}・{when(c.at)}）</option>)}
            </select>
            <button className="btn-ghost btn-sm h-7 px-1.5" disabled={idx <= 0} onClick={() => pick(v.commits[idx - 1]?.number ?? sel)} aria-label="ひとつ後の変更" title="ひとつ後の変更">›</button>
          </span>
        )}
        {tab === "ide" && (
          <span className="ml-2 flex rounded-lg bg-zinc-100 p-0.5" role="group" aria-label="見るコード">
            <button aria-pressed={src === "workspace"} onClick={() => setSrc("workspace")} className={`flex items-center gap-1 rounded-md px-2.5 py-0.5 text-[12px] ${src === "workspace" ? "bg-white font-semibold shadow-sm" : "text-zinc-500"}`}><FileCode2 size={12} />作業場（{v.files}）</button>
            <button aria-pressed={src === "github"} disabled={!v.repo} onClick={() => setSrc("github")} title={v.repo ? `${v.repo}@${v.branch}` : "GitHub につないでいません"} className={`flex items-center gap-1 rounded-md px-2.5 py-0.5 text-[12px] disabled:opacity-40 ${src === "github" ? "bg-white font-semibold shadow-sm" : "text-zinc-500"}`}><Github size={12} />GitHub</button>
          </span>
        )}
        <span className="ml-auto flex items-center gap-1 text-[11px] text-zinc-400"><RefreshCw size={11} />数秒ごとに読み直します</span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "diff" && (v.commits.length ? <DiffView pid={pid} number={sel} />
          : <p className="p-6 text-[13px] text-zinc-400">まだ変更の記録がありません。⑫の担当が Issue を受けて動くと、ここに書いたコードの差分が出ます。</p>)}
        {tab === "ide" && (ide
          ? <iframe key={src} title="IDE" src={`/ide/index.html?p=${encodeURIComponent(src === "github" ? `${pid}~github` : pid)}`} className="h-full w-full border-0 bg-[#1f1f1f]" />
          : <FileView pid={pid} src={src} version={src === "workspace" ? (latest ?? 0) : 0} />)}
      </div>
    </div>
  );
}

function SyncBar({ pid, v, canSync, onChanged }: { pid: string; v: WsView; canSync: boolean; onChanged: () => void }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const s = v.sync;
  const run = (fn: (p: string) => Promise<{ error?: string }>) => start(async () => { const r = await fn(pid); setErr(r.error ?? null); onChanged(); });
  if (!v.repo) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-3 py-2 text-[12px] text-zinc-600">
        <FileCode2 size={13} /><span className="font-medium">ファクトリーの作業場（{v.files} ファイル）</span>
        <span className="text-zinc-400">GitHub は未連携です。</span>
        <a href={`/p/${pid}/code?edit=1`} className="text-brand-700 hover:underline">GitHub につなぐ</a>
      </div>
    );
  }
  const badge = { ok: ["bg-emerald-50 text-emerald-800", "GitHub と揃っています"], pending: ["bg-sky-50 text-sky-800", "GitHub に写しています…"], diverged: ["bg-amber-50 text-amber-900", "GitHub で直接変更されています"], error: ["bg-rose-50 text-rose-800", "GitHub に送れませんでした"], off: ["bg-zinc-100 text-zinc-600", "まだ写していません"] }[s.status];
  return (
    <div className="border-b border-zinc-200 px-3 py-2 text-[12px]" aria-label="GitHub への写し">
      <div className="flex flex-wrap items-center gap-2">
        <Github size={13} />
        <a href={`https://github.com/${v.repo}`} target="_blank" rel="noreferrer" className="font-medium hover:underline">{v.repo}</a>
        <span className="text-zinc-400">@{v.branch}</span>
        <span className={`flex items-center gap-1 rounded px-2 py-0.5 ${badge[0]}`}>
          {s.status === "pending" ? <Loader2 size={12} className="animate-spin" /> : s.status === "diverged" || s.status === "error" ? <AlertTriangle size={12} /> : <Check size={12} />}
          {badge[1]}{s.unpushed ? `（未送信 ${s.unpushed} 件）` : ""}
        </span>
        {canSync && (s.status === "diverged"
          ? <>
            <button className="btn-primary btn-sm" disabled={pending} onClick={() => { if (confirm("GitHub で直接された変更を捨てて、GitHub を作業場の内容に戻します（履歴は残ります）。よいですか？")) run(overwriteWorkspace); }}><UploadCloud size={12} />作業場の内容で上書き</button>
            <button className="btn-secondary btn-sm" disabled={pending} onClick={() => run(importWorkspace)} title="例外：GitHub で直した内容を残したいとき"><ArrowDownToLine size={12} />GitHub の変更を取り込む</button>
          </>
          : s.unpushed > 0 && <button className="btn-secondary btn-sm" disabled={pending} onClick={() => run(pushWorkspace)}><UploadCloud size={12} />いま送る</button>)}
        {pending && <Loader2 size={13} className="animate-spin text-zinc-400" />}
        <span className="ml-auto text-[11px] text-zinc-400">GitHub は作業場の写しです。GitHub で直接変更しないでください</span>
        <a href={`/p/${pid}/code?edit=1`} className="text-[11px] text-zinc-400 hover:text-zinc-700">つなぎ先を変える</a>
      </div>
      {(s.error || err) && <p className="mt-1 text-rose-700">{err ?? s.error}</p>}
    </div>
  );
}

// 差分：ファイルごとに、足した行（緑）・消した行（赤）
function DiffView({ pid, number }: { pid: string; number: number | null }) {
  const [c, setC] = useState<WsCommit | null>(null);
  useEffect(() => {
    if (number === null) return;
    let live = true;
    fetch(`/api/p/${pid}/workspace/commits/${number}`).then((r) => (r.ok ? r.json() : null)).then((x) => { if (live) setC(x); });
    return () => { live = false; };
  }, [pid, number]);
  const files = useMemo(() => (c?.patch ?? "").split(/(?=^--- )/m).filter((x) => x.trim()), [c?.patch]);
  if (number === null) return <p className="p-6 text-[13px] text-zinc-400">変更の記録を選ぶと、ここに差分が出ます。</p>;
  if (!c) return <p className="p-6 text-[13px] text-zinc-400"><Loader2 size={13} className="mr-1 inline animate-spin" />読んでいます…</p>;
  return (
    <div className="h-full overflow-y-auto p-4" aria-label="差分">
      <div className="mb-3">
        <div className="text-[11.5px] text-zinc-500">#{c.number}・{c.author}・{when(c.at)}{c.unit ? `・${c.unit}` : ""}</div>
        <div className="whitespace-pre-wrap text-[14px] font-medium">{c.message}</div>
        <div className="mt-1 flex flex-wrap gap-2 text-[11.5px]">{c.files.map((f) => <span key={f.path} className={OP[f.op]?.tone}>{OP[f.op]?.label} {f.path}</span>)}</div>
      </div>
      {files.map((chunk, i) => {
        const lines = chunk.split("\n");
        const name = (lines[1] ?? "").replace(/^\+\+\+ (b\/)?/, "").replace("/dev/null", (lines[0] ?? "").replace(/^--- (a\/)?/, ""));
        return (
          <div key={i} className="mb-3 overflow-hidden rounded-lg border border-zinc-200">
            <div className="border-b border-zinc-200 bg-zinc-50 px-3 py-1 font-mono text-[11.5px] text-zinc-700">{name}</div>
            <pre className="overflow-x-auto text-[11.5px] leading-5">
              {lines.slice(2).map((l, k) => (
                <div key={k} className={l.startsWith("+") ? "bg-emerald-50 text-emerald-900" : l.startsWith("-") ? "bg-rose-50 text-rose-900" : l.startsWith("@@") ? "bg-sky-50 text-sky-800" : "text-zinc-700"}>
                  <span className="select-none px-2 text-zinc-300">{l.startsWith("+") ? "+" : l.startsWith("-") ? "−" : " "}</span>{l.slice(l.startsWith("@@") ? 0 : 1) || " "}
                </div>
              ))}
            </pre>
          </div>
        );
      })}
    </div>
  );
}

// IDE を配置していないときの、ファイルの一覧と中身（作業場か GitHub か）
function FileView({ pid, src, version }: { pid: string; src: "workspace" | "github"; version: number }) {
  const [entries, setEntries] = useState<{ path: string; type: string; size: number }[]>([]);
  const [path, setPath] = useState<string | null>(null);
  const [body, setBody] = useState<string>("");
  useEffect(() => {
    setPath(null);
    fetch(`/api/p/${pid}/code/tree?source=${src}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : { entries: [] })).then((t) => setEntries(t.entries ?? []));
  }, [pid, src, version]);
  useEffect(() => {
    if (!path) return;
    fetch(`/api/p/${pid}/code/file?path=${encodeURIComponent(path)}&source=${src}`, { cache: "no-store" }).then((r) => (r.ok ? r.text() : "（読めませんでした）")).then(setBody);
  }, [pid, path, src, version]);
  const files = entries.filter((e) => e.type === "file");
  return (
    <div className="grid h-full grid-cols-[260px_minmax(0,1fr)]">
      <ul className="overflow-y-auto border-r border-zinc-200 py-1 text-[12px]" aria-label="ファイルの一覧">
        {files.length === 0 && <li className="px-3 py-2 text-zinc-400">まだファイルがありません。</li>}
        {files.map((f) => (
          <li key={f.path}><button onClick={() => setPath(f.path)} aria-pressed={path === f.path}
            className={`block w-full truncate px-3 py-1 text-left font-mono text-[11.5px] ${path === f.path ? "bg-brand-50 text-brand-800" : "text-zinc-700 hover:bg-zinc-50"}`} title={f.path}>
            <span className="text-zinc-400">{f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/") + 1) : ""}</span>{f.path.split("/").pop()}</button></li>
        ))}
      </ul>
      <div className="min-w-0 overflow-auto">
        {path ? (
          <>
            <div className="sticky top-0 border-b border-zinc-200 bg-white px-3 py-1 font-mono text-[11.5px] text-zinc-600">{path}</div>
            <pre className="p-3 text-[12px] leading-5 text-zinc-800">{body.split("\n").map((l, i) => <div key={i}><span className="mr-3 inline-block w-8 select-none text-right text-zinc-300">{i + 1}</span>{l || " "}</div>)}</pre>
          </>
        ) : <p className="p-6 text-[13px] text-zinc-400">左からファイルを選びます。</p>}
      </div>
    </div>
  );
}
