"use client";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { AlertTriangle, ArrowDownToLine, Bot, Check, CircleDashed, Code2, FileCode2, FolderTree, GitCommitHorizontal, Github, Loader2, RefreshCw, UploadCloud, User } from "lucide-react";
import { importWorkspace, pushWorkspace, type WsCommit, type WsView } from "@/app/(app)/p/[id]/code/actions";

const when = (t: string | null) => (t ? new Date(t).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const OP: Record<string, { label: string; tone: string }> = { add: { label: "追加", tone: "text-emerald-700" }, modify: { label: "変更", tone: "text-sky-700" }, delete: { label: "削除", tone: "text-rose-700" } };
type Tab = "diff" | "files" | "ide";

// 開発：エージェントが作業場に書いているコードを見る。左にユニットと変更の記録、中央に差分・ファイル・IDE
export function DevRoom({ pid, initial, ide, canSync }: { pid: string; initial: WsView; ide: boolean; canSync: boolean }) {
  const [v, setV] = useState(initial);
  const [sel, setSel] = useState<number | null>(initial.commits[0]?.number ?? null);
  const [tab, setTab] = useState<Tab>(initial.commits.length ? "diff" : "files");
  const [unit, setUnit] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    const r = await fetch(`/api/p/${pid}/workspace`, { cache: "no-store" }).catch(() => null);
    if (r?.ok) setV(await r.json());
  }, [pid]);
  useEffect(() => { const t = setInterval(load, 6000); return () => clearInterval(t); }, [load]);
  const commits = unit === null ? v.commits : v.commits.filter((c) => c.unit === unit);
  return (
    <div className="grid h-full min-h-0 grid-cols-[300px_minmax(0,1fr)] overflow-hidden rounded-xl border border-zinc-200 bg-white" aria-label="開発">
      <aside className="flex min-h-0 flex-col border-r border-zinc-200 bg-zinc-50/50">
        <SyncBar pid={pid} v={v} canSync={canSync} onChanged={load} />
        <section className="max-h-[42%] overflow-y-auto border-b border-zinc-200 px-2 py-2" aria-label="ユニット">
          <div className="mb-1 flex items-center px-1 text-[12px] font-semibold text-zinc-600">ユニット（⑨のユニット分割）
            {unit !== null && <button className="ml-auto text-[11px] font-normal text-brand-700" onClick={() => setUnit(null)}>すべて</button>}</div>
          {v.units.length === 0 && <p className="px-1 text-[11.5px] text-zinc-400">⑨のユニット分割がまだありません。⑫の担当は、⑨のユニットごとにコードを書きます。</p>}
          {v.units.map((u) => (
            <button key={u.id || "none"} onClick={() => setUnit(u.id === unit ? null : u.id)} aria-pressed={u.id === unit}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] ${u.id === unit ? "bg-white shadow-sm ring-1 ring-zinc-200" : "hover:bg-white"}`}>
              {u.commits ? <Check size={13} className="shrink-0 text-emerald-600" /> : <CircleDashed size={13} className="shrink-0 text-zinc-300" />}
              <span className="shrink-0 font-mono text-[10.5px] text-zinc-400">{u.id}</span>
              <span className="min-w-0 flex-1 truncate">{u.name}</span>
              <span className="shrink-0 text-[10.5px] text-zinc-400">{u.commits ? `${u.commits}件` : "未着手"}</span>
            </button>
          ))}
        </section>
        <section className="min-h-0 flex-1 overflow-y-auto px-2 py-2" aria-label="変更の記録">
          <div className="mb-1 px-1 text-[12px] font-semibold text-zinc-600">変更の記録{unit !== null ? `（${unit || "ユニットなし"}）` : ""}</div>
          {commits.length === 0 && <p className="px-1 text-[11.5px] text-zinc-400">まだありません。⑫の担当が Issue を受けて動くと、ここに書いたコードの記録が増えます。</p>}
          {commits.map((c) => (
            <button key={c.number} onClick={() => { setSel(c.number); setTab("diff"); }} aria-pressed={sel === c.number}
              className={`pf-rise mb-1 block w-full rounded-md px-2 py-1.5 text-left text-[12px] ${sel === c.number ? "bg-white shadow-sm ring-1 ring-brand-200" : "hover:bg-white"}`}>
              <div className="flex items-center gap-1.5 text-[10.5px] text-zinc-500">
                {c.source === "human" ? <User size={11} /> : c.source === "github" ? <Github size={11} /> : <Bot size={11} />}
                <span className="truncate">{c.author}</span><span className="ml-auto shrink-0">#{c.number}・{when(c.at)}</span>
              </div>
              <div className="mt-0.5 line-clamp-2 text-zinc-800">{c.unit && <span className="mr-1 font-mono text-[10.5px] text-brand-700">{c.unit}</span>}{c.message}</div>
              <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-zinc-400">
                <span>{c.files.length} ファイル</span>
                <span className="text-emerald-700">+{c.files.reduce((n, f) => n + (f.lines?.[0] ?? 0), 0)}</span>
                <span className="text-rose-700">−{c.files.reduce((n, f) => n + (f.lines?.[1] ?? 0), 0)}</span>
                {v.repo && (c.github_sha ? <span title="GitHub に送りました" className="ml-auto flex items-center gap-0.5"><Github size={10} />済</span> : <span className="ml-auto">未送信</span>)}
              </div>
            </button>
          ))}
        </section>
      </aside>
      <section className="flex min-h-0 min-w-0 flex-col">
        <div className="flex items-center gap-1 border-b border-zinc-200 px-3 py-1.5 text-[12.5px]" role="tablist">
          {([["diff", "変更", GitCommitHorizontal], ["files", `ファイル（${v.files}）`, FolderTree], ...(ide ? [["ide", "IDE", Code2] as const] : [])] as const).map(([k, l, I]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`flex items-center gap-1 rounded-md px-2.5 py-1 ${tab === k ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}><I size={13} />{l}</button>
          ))}
          <span className="ml-auto flex items-center gap-1 text-[11px] text-zinc-400"><RefreshCw size={11} />数秒ごとに読み直します</span>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {tab === "diff" && <DiffView pid={pid} number={sel} />}
          {tab === "files" && <FileView pid={pid} version={v.commits[0]?.number ?? 0} />}
          {tab === "ide" && ide && <iframe title="IDE" src={`/ide/index.html?p=${encodeURIComponent(pid)}`} className="h-full w-full border-0 bg-[#1f1f1f]" />}
        </div>
      </section>
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
      <div className="border-b border-zinc-200 px-3 py-2.5 text-[11.5px] text-zinc-500">
        <div className="flex items-center gap-1.5 font-medium text-zinc-700"><FileCode2 size={13} />ファクトリーの作業場（{v.files} ファイル）</div>
        GitHub は未連携です。<a href={`/p/${pid}/code?edit=1`} className="text-brand-700 hover:underline">GitHub につなぐ</a>と、作業場のコードを写します（作業場はそのまま使い続けます）。
      </div>
    );
  }
  const badge = { ok: ["bg-emerald-50 text-emerald-800", "GitHub と揃っています"], pending: ["bg-sky-50 text-sky-800", "GitHub に写しています…"], diverged: ["bg-amber-50 text-amber-900", "GitHub に作業場にない変更があります"], error: ["bg-rose-50 text-rose-800", "GitHub に送れませんでした"], off: ["bg-zinc-100 text-zinc-600", "まだ写していません"] }[s.status];
  return (
    <div className="space-y-1.5 border-b border-zinc-200 px-3 py-2.5 text-[11.5px]" aria-label="GitHub への写し">
      <div className="flex items-center gap-1.5">
        <Github size={13} />
        <a href={`https://github.com/${v.repo}`} target="_blank" rel="noreferrer" className="min-w-0 truncate font-medium hover:underline">{v.repo}</a>
        <span className="shrink-0 text-zinc-400">@{v.branch}</span>
        <a href={`/p/${pid}/code?edit=1`} className="ml-auto shrink-0 text-[10.5px] text-zinc-400 hover:text-zinc-700">変える</a>
      </div>
      <div className={`flex items-center gap-1.5 rounded px-2 py-1 ${badge[0]}`}>
        {s.status === "pending" ? <Loader2 size={12} className="animate-spin" /> : s.status === "diverged" || s.status === "error" ? <AlertTriangle size={12} /> : <Check size={12} />}
        <span>{badge[1]}{s.unpushed ? `（未送信 ${s.unpushed} 件）` : ""}</span>
      </div>
      {s.error && <p className="text-rose-700">{s.error}</p>}
      {canSync && (
        <div className="flex gap-1.5">
          {s.status === "diverged"
            ? <button className="btn-primary btn-sm" disabled={pending} onClick={() => run(importWorkspace)}><ArrowDownToLine size={12} />GitHub の変更を取り込む</button>
            : s.unpushed > 0 && <button className="btn-secondary btn-sm" disabled={pending} onClick={() => run(pushWorkspace)}><UploadCloud size={12} />いま送る</button>}
          {pending && <Loader2 size={13} className="animate-spin self-center text-zinc-400" />}
        </div>
      )}
      {err && <p className="text-rose-700">{err}</p>}
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

// ファイル：作業場の一覧と中身（IDE がなくても読める）
function FileView({ pid, version }: { pid: string; version: number }) {
  const [entries, setEntries] = useState<{ path: string; type: string; size: number }[]>([]);
  const [path, setPath] = useState<string | null>(null);
  const [body, setBody] = useState<string>("");
  useEffect(() => {
    fetch(`/api/p/${pid}/code/tree`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : { entries: [] })).then((t) => setEntries(t.entries ?? []));
  }, [pid, version]);
  useEffect(() => {
    if (!path) return;
    fetch(`/api/p/${pid}/code/file?path=${encodeURIComponent(path)}`, { cache: "no-store" }).then((r) => (r.ok ? r.text() : "（読めませんでした）")).then(setBody);
  }, [pid, path, version]);
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
