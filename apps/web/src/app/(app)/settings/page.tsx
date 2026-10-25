import Link from "next/link";
import { ChevronLeft, ShieldCheck } from "lucide-react";
import { agent, type LlmSettings } from "@/lib/agent";
import { Logo } from "@/components/Logo";
import { UserMenu } from "@/components/UserMenu";
import { LlmSettingsForm } from "@/components/settings/LlmSettingsForm";

const SOURCE: Record<string, string> = { tenant: "このテナントの設定", app: "アプリ全体の既定", env: "サーバーの環境変数" };

export default async function SettingsPage() {
  const s = await agent<LlmSettings>("/settings/llm");
  const eff = s.effective;
  return (
    <>
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-6">
          <Logo />
          <UserMenu />
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-8 px-6 py-10">
        <div>
          <Link href="/" className="mb-3 flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900"><ChevronLeft size={14} />すべてのプロダクト</Link>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">設定</h1>
            {s.is_admin && <span className="chip border-brand-200 bg-brand-50 text-brand-700"><ShieldCheck size={11} />プラットフォーム管理者</span>}
          </div>
          <p className="mt-1 text-sm text-zinc-500">このテナントで使う AI（LLM）の接続を決めます。ステージの開閉と承認は、各プロダクトの「ステージの設定」で決めます。</p>
        </div>

        <section className="card p-5">
          <div className="section-title mb-2">いま使っている接続</div>
          <dl className="grid grid-cols-[8rem_1fr] gap-y-1.5 text-[13px]">
            <dt className="text-zinc-500">接続方式</dt><dd className="font-medium">{eff.provider_label}</dd>
            <dt className="text-zinc-500">対話のモデル</dt><dd className="font-mono text-[12px]">{eff.chat_model || "—"}</dd>
            <dt className="text-zinc-500">レポートのモデル</dt><dd className="font-mono text-[12px]">{eff.summary_model || "—"}</dd>
            <dt className="text-zinc-500">画像のモデル</dt><dd className="font-mono text-[12px]">{eff.image_model || "仮の絵（この接続では画像を生成しません）"}</dd>
            {eff.base_url && <><dt className="text-zinc-500">URL</dt><dd className="font-mono text-[12px]">{eff.base_url}</dd></>}
            <dt className="text-zinc-500">どこの設定か</dt><dd>{SOURCE[eff.source]}</dd>
          </dl>
        </section>

        <LlmSettingsForm scope="tenant" title="このテナントの接続"
          note="空のままならアプリ全体の既定を使います。API キーは暗号化して保存し、画面には末尾4文字だけを出します。"
          view={s.tenant} canEdit={s.can_edit} allowVertex={s.allow_tenant_vertex} options={s.options}
          inheritLabel={`アプリ全体の既定を使う（${s.app_effective.provider_label}・${s.app_effective.chat_model || "—"}）`} />

        {!s.admin_configured && s.can_edit && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
            プラットフォーム管理者が設定されていません。GitHub の Variables に <code>PF_ADMIN_EMAILS</code>（ログインに使うメールアドレス。複数は ; 区切り）を入れて deploy を実行すると、
            その人がアプリ全体の既定と Vertex AI（キー不要）の接続を決められるようになります。
          </p>
        )}

        {s.is_admin && (
          <LlmSettingsForm scope="app" title="アプリ全体の既定（プラットフォーム管理者）"
            note="上書きしていないテナントは、すべてこの接続を使います。費用はこの接続の持ち主にかかります。Vertex AI の費用は、このアプリを動かしている GCP プロジェクトにかかります。"
            view={s.app} canEdit allowVertex options={s.options} />
        )}
      </main>
    </>
  );
}
