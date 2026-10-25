"use client";
import { useState, useTransition } from "react";
import { CheckCircle2, KeyRound, List, PlugZap, XCircle } from "lucide-react";
import type { LlmProvider, LlmSettings, LlmTestResult, LlmView } from "@/lib/agent";
import { listLlmModels, saveLlm, testLlm, type LlmForm } from "@/app/(app)/settings/actions";

type Props = {
  scope: "tenant" | "app"; title: string; note: string; view: LlmView | null; canEdit: boolean;
  allowVertex: boolean; options: LlmSettings["options"]; inheritLabel?: string;
};

const HELP: Record<LlmProvider, string> = {
  stub: "AIを呼ばず、決まった仮の値を返します。動作確認用です。",
  gemini: "Google AI Studio の API キーで Gemini を使います。画像生成もできます。",
  vertex: "API キーは不要です。サーバー（Cloud Run）のサービスアカウントで Vertex AI に接続し、Gemini と Claude を使えます。費用はアプリを動かしている GCP プロジェクトにかかります。",
  anthropic: "Anthropic の API キーで Claude を使います。画像は生成しません（仮の絵になります）。",
  openai: "OpenAI 互換の /chat/completions を持つ API（Ollama・LM Studio・vLLM・OpenAI など）を使います。URL は「…/v1」まで入れてください。",
};

export function LlmSettingsForm({ scope, title, note, view, canEdit, allowVertex, options, inheritLabel }: Props) {
  const initial: LlmForm = {
    provider: view?.provider ?? (scope === "tenant" ? "inherit" : "stub"),
    chat_model: view?.chat_model ?? "", summary_model: view?.summary_model ?? "", image_model: view?.image_model ?? "",
    base_url: view?.base_url ?? "", project: view?.project ?? "", location: view?.location ?? "",
    api_key: "", clear_key: false, allow_tenant_vertex: view?.allow_tenant_vertex ?? false,
  };
  const [f, setF] = useState<LlmForm>(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [test, setTest] = useState<LlmTestResult | null>(null);
  const [models, setModels] = useState<{ ok: boolean; models: string[]; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof LlmForm>(k: K, v: LlmForm[K]) => { setF((x) => ({ ...x, [k]: v })); setMsg(null); };

  const p = f.provider as LlmProvider | "inherit";
  const real = p !== "inherit";
  const defaults = real ? options.defaults[p] : null;
  const keyField = real && (options.needs_key.includes(p) || p === "openai");
  const keySaved = view?.has_key && view.provider === p;
  const listId = `${scope}-models`;
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);

  function save() {
    start(async () => {
      const r = await saveLlm(scope, f);
      if (r.error) setMsg({ ok: false, text: r.error });
      else { setMsg({ ok: true, text: "保存しました" }); setF((x) => ({ ...x, api_key: "", clear_key: false })); }
    });
  }
  function runList() {
    setModels(null);
    start(async () => setModels(await listLlmModels(scope)));
  }
  function runTest() {
    setTest(null);
    start(async () => setTest(await testLlm(scope)));
  }

  return (
    <section className="card p-5" aria-label={title}>
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {view?.updated_by && <span className="ml-auto text-[11px] text-zinc-400">最終更新：{view.updated_by}</span>}
      </div>
      <p className="mb-4 text-[12px] leading-5 text-zinc-500">{note}</p>
      {!canEdit && <p className="mb-4 rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-500">接続はテナントの OWNER だけが変えられます。</p>}

      <fieldset disabled={!canEdit || pending} className="space-y-4">
        <div>
          <label className="label" htmlFor={`${scope}-provider`}>接続方式</label>
          <select id={`${scope}-provider`} value={f.provider} onChange={(e) => set("provider", e.target.value)} className="input">
            {scope === "tenant" && <option value="inherit">{inheritLabel}</option>}
            {(Object.keys(options.providers) as LlmProvider[]).map((k) => (
              <option key={k} value={k} disabled={k === "vertex" && !allowVertex}>
                {options.providers[k]}{k === "vertex" && !allowVertex ? "（プラットフォーム管理者の許可が必要）" : ""}
              </option>
            ))}
          </select>
          {real && <p className="mt-1.5 text-[12px] leading-5 text-zinc-500">{HELP[p]}</p>}
        </div>

        {p === "openai" && (
          <div>
            <label className="label" htmlFor={`${scope}-url`}>URL</label>
            <input id={`${scope}-url`} value={f.base_url} onChange={(e) => set("base_url", e.target.value)} className="input font-mono text-[12px]"
              placeholder={scope === "app" ? "例：http://ollama.internal:11434/v1" : "例：https://llm.example.com/v1"} />
            <p className="mt-1.5 text-[11px] leading-5 text-zinc-500">
              このアプリのサーバーから届く URL が必要です。クラウドで動かしている場合、手元の PC の localhost には届きません（トンネルなどで公開した URL を使ってください）。
              {scope === "tenant" && " テナントの設定では、https の公開 URL だけを受け付けます。"}
            </p>
          </div>
        )}

        {p === "vertex" && (
          <div className="grid gap-3 sm:grid-cols-2">
            {scope === "app" && (
              <div>
                <label className="label" htmlFor={`${scope}-project`}>GCP プロジェクト</label>
                <input id={`${scope}-project`} value={f.project} onChange={(e) => set("project", e.target.value)} className="input font-mono text-[12px]"
                  placeholder={options.vertex_project ?? "サーバーのプロジェクト"} />
              </div>
            )}
            <div>
              <label className="label" htmlFor={`${scope}-location`}>リージョン</label>
              <input id={`${scope}-location`} value={f.location} onChange={(e) => set("location", e.target.value)} className="input font-mono text-[12px]"
                placeholder={options.vertex_location} />
            </div>
          </div>
        )}

        {keyField && (
          <div>
            <label className="label" htmlFor={`${scope}-key`}>API キー{p === "openai" && "（要らなければ空）"}</label>
            <div className="flex items-center gap-2">
              <input id={`${scope}-key`} type="password" autoComplete="off" value={f.api_key} onChange={(e) => set("api_key", e.target.value)}
                className="input font-mono text-[12px]" placeholder={keySaved ? `保存済み（…${view?.key_hint}）。変えるときだけ入力` : "キーを入力"} />
              {keySaved && <span className="chip shrink-0"><KeyRound size={11} />…{view?.key_hint}</span>}
            </div>
            {keySaved && p === "openai" && (
              <label className="mt-1.5 flex items-center gap-1.5 text-[12px] text-zinc-600">
                <input type="checkbox" checked={f.clear_key} onChange={(e) => set("clear_key", e.target.checked)} />保存済みのキーを消す
              </label>
            )}
          </div>
        )}

        {real && p !== "stub" && (
          <div className="grid gap-3 sm:grid-cols-3">
            <datalist id={listId}>{(models?.ok && models.models.length ? models.models : options.suggested[p] ?? []).map((m) => <option key={m} value={m} />)}</datalist>
            {([["chat_model", "対話のモデル"], ["summary_model", "レポートのモデル"]] as const).map(([k, label]) => (
              <div key={k}>
                <label className="label" htmlFor={`${scope}-${k}`}>{label}</label>
                <input id={`${scope}-${k}`} list={listId} value={f[k]} onChange={(e) => set(k, e.target.value)} className="input font-mono text-[12px]"
                  placeholder={(k === "chat_model" ? defaults?.chat : f.chat_model || defaults?.summary) || "モデル名"} />
              </div>
            ))}
            {options.image_providers.includes(p) && (
              <div>
                <label className="label" htmlFor={`${scope}-image`}>画像のモデル</label>
                <input id={`${scope}-image`} value={f.image_model} onChange={(e) => set("image_model", e.target.value)} className="input font-mono text-[12px]"
                  placeholder={defaults?.image} />
              </div>
            )}
          </div>
        )}
        {real && p !== "stub" && <p className="-mt-2 text-[11px] text-zinc-400">空欄は薄く出ている既定のモデルを使います。モデルは提供元の都合で引退するので、つながらないときは「使えるモデルを取得」で確かめてください。{p === "vertex" && "「claude-」で始まるモデル名にすると Claude を使います。"}</p>}

        {scope === "app" && (
          <label className="flex items-start gap-2 text-[13px]">
            <input type="checkbox" className="mt-1" checked={f.allow_tenant_vertex} onChange={(e) => set("allow_tenant_vertex", e.target.checked)} />
            <span>テナントが Vertex AI（キー不要）を選ぶのを許す<span className="block text-[11px] text-zinc-500">許すと、各テナントの利用料もこのアプリの GCP プロジェクトにかかります。</span></span>
          </label>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button type="button" onClick={save} disabled={!dirty} className="btn-primary btn-sm">{pending ? "処理中…" : "保存"}</button>
          <button type="button" onClick={runTest} disabled={dirty} className="btn-secondary btn-sm" title={dirty ? "保存してから試せます" : "保存した設定で、AIに短い返事をもらいます"}>
            <PlugZap size={13} />接続テスト
          </button>
          <button type="button" onClick={runList} disabled={dirty} className="btn-secondary btn-sm" title={dirty ? "保存してから取得できます" : "保存した接続先に、いま使えるモデルを問い合わせます"}>
            <List size={13} />使えるモデルを取得
          </button>
          {msg && <span className={`text-xs ${msg.ok ? "text-emerald-600" : "text-rose-600"}`}>{msg.text}</span>}
        </div>
        {models && (
          <div className="rounded-md border border-zinc-200 px-3 py-2 text-xs">
            {!models.ok ? <span className="text-rose-600">取得できません：{models.error}</span>
              : models.models.length === 0 ? <span className="text-zinc-500">使えるモデルが見つかりませんでした。</span>
              : (
                <>
                  <div className="mb-1.5 text-zinc-500">いま使えるモデル（{models.models.length}）。押すと対話のモデルに入ります（保存で反映）。</div>
                  <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
                    {models.models.map((m) => (
                      <button key={m} type="button" onClick={() => set("chat_model", m)}
                        className={`chip font-mono hover:border-brand-300 ${f.chat_model === m ? "border-brand-400 bg-brand-50 text-brand-700" : ""}`}>{m}</button>
                    ))}
                  </div>
                </>
              )}
          </div>
        )}
        {test && (
          <div role="status" className={`flex items-start gap-2 rounded-md px-3 py-2 text-xs ${test.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>
            {test.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <XCircle size={14} className="mt-0.5 shrink-0" />}
            <span className="break-all">{test.ok ? `つながりました（${test.model}・${test.ms}ms）：${test.reply}` : `つながりません（${test.model || "—"}）：${test.error}`}</span>
          </div>
        )}
      </fieldset>
    </section>
  );
}
