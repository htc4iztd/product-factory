"use client";
import { useState, useTransition } from "react";
import { CheckCircle2, Github, KeyRound, XCircle } from "lucide-react";
import type { GithubToken } from "@/lib/agent";
import { saveGithubToken, testGithub } from "@/app/(app)/settings/actions";

const SOURCE = { tenant: "このテナントのトークン", server: "サーバーの GITHUB_TOKEN", none: "なし" };

export function GithubTokenForm({ status }: { status: GithubToken }) {
  const [token, setToken] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <section className="card p-5" aria-label="GitHub 連携">
      <h2 className="mb-1 flex items-center gap-2 text-[15px] font-semibold"><Github size={16} />GitHub 連携</h2>
      <p className="mb-4 text-[12px] leading-5 text-zinc-500">
        チケットと Issues の同期、非公開リポジトリのコードを読むのに使います。fine-grained personal access token で、対象リポジトリに
        Issues（Read and write）と Contents（Read-only）を付けてください。暗号化して保存し、画面には末尾4文字だけを出します。
      </p>
      <div className="mb-3 flex items-center gap-2 text-[13px]">
        <span className="text-zinc-500">いま使っているトークン：</span>{SOURCE[status.source]}
        {status.hint && <span className="chip"><KeyRound size={11} />…{status.hint}</span>}
      </div>
      <fieldset disabled={!status.can_edit || pending} className="space-y-3">
        <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} aria-label="GitHub のトークン"
          className="input font-mono text-[12px]" placeholder={status.hint ? "変えるときだけ入力" : "github_pat_..."} />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={!token} className="btn-primary btn-sm"
            onClick={() => start(async () => { const r = await saveGithubToken(token); setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: "保存しました" }); if (!r.error) setToken(""); })}>保存</button>
          {status.source === "tenant" && (
            <button type="button" className="btn-ghost btn-sm" onClick={() => start(async () => { await saveGithubToken(null); setMsg({ ok: true, text: "消しました" }); })}>トークンを消す</button>
          )}
          <button type="button" className="btn-secondary btn-sm"
            onClick={() => start(async () => { const r = await testGithub(); setMsg(r.ok ? { ok: true, text: `つながりました（${r.login}）` } : { ok: false, text: `つながりません：${r.error}` }); })}>
            接続テスト
          </button>
          {msg && <span className={`flex items-center gap-1 text-xs ${msg.ok ? "text-emerald-600" : "text-rose-600"}`}>{msg.ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />}{msg.text}</span>}
        </div>
      </fieldset>
      {!status.can_edit && <p className="mt-2 text-xs text-zinc-500">トークンはテナントの OWNER だけが変えられます。</p>}
    </section>
  );
}
