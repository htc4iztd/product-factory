import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ExternalLink, GitBranch, Github } from "lucide-react";
import { agent, AgentError, type Overview } from "@/lib/agent";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string; error?: string }> };

export default async function CodePage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const ov = await agent<Overview>(`/products/${id}`);
  const p = ov.product;

  async function link(formData: FormData) {
    "use server";
    try {
      await agent(`/products/${id}/repo`, { method: "PUT", body: { repo: String(formData.get("repo") ?? ""), branch: String(formData.get("branch") ?? "") || null } });
    } catch (e) {
      if (e instanceof AgentError) redirect(`/p/${id}/code?edit=1&error=${encodeURIComponent(e.message)}`);
      throw e;
    }
    revalidatePath(`/p/${id}`, "layout");
    redirect(`/p/${id}/code`);
  }

  if (!p.repo || sp.edit) {
    return (
      <div className="mx-auto max-w-xl px-8 py-16">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900 text-white"><Github size={18} /></div>
          <div>
            <h1 className="text-xl font-semibold">コード（IDE）</h1>
            <p className="text-[13px] text-zinc-500">プロダクトの GitHub リポジトリをつなぐと、ここで Code-OSS の画面でコードを読めます。</p>
          </div>
        </div>
        <form action={link} className="card space-y-4 p-5">
          <div>
            <label className="label" htmlFor="repo">リポジトリ（owner/name か URL）</label>
            <input id="repo" name="repo" defaultValue={p.repo ?? ""} placeholder="例：acme/kakeibo" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="branch">ブランチ（空ならリポジトリの既定）</label>
            <input id="branch" name="branch" defaultValue={p.repo_branch ?? ""} placeholder="main" className="input" />
          </div>
          {sp.error && <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{sp.error}</p>}
          <p className="text-[11px] leading-5 text-zinc-500">
            公開リポジトリはそのまま読めます。非公開リポジトリは、そのリポジトリを読めるトークンを Secret Manager の GITHUB_TOKEN に入れてください。
            読むだけで、このアプリからリポジトリへは書き込みません。空にして保存すると、つなぎを外します。
          </p>
          <button className="btn-primary">つなぐ</button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-zinc-200 bg-white px-6 py-2.5 text-[13px]">
        <Github size={15} />
        <a href={`https://github.com/${p.repo}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-medium hover:underline">
          {p.repo}<ExternalLink size={11} className="text-zinc-400" />
        </a>
        <span className="chip"><GitBranch size={11} />{p.repo_branch}</span>
        <span className="text-[11px] text-zinc-400">読み取り専用・Code-OSS（Web 版）</span>
        <a href={`/p/${id}/code?edit=1`} className="btn-ghost btn-sm ml-auto">リポジトリを変える</a>
      </header>
      {process.env.IDE_ORIGIN ? (
        <iframe title="IDE" src={`/ide/index.html?p=${encodeURIComponent(id)}`} className="min-h-0 w-full flex-1 border-0 bg-[#1f1f1f]" />
      ) : (
        <div className="mx-auto mt-16 max-w-lg space-y-2 px-8 text-[13px] leading-6 text-zinc-600">
          <p className="font-medium text-zinc-900">IDE がまだ配置されていません</p>
          <p>リポジトリはつながっています。GitHub の Actions で <code className="kbd">ide</code> ワークフローを実行すると、IDE が配置され、この画面で開けるようになります。</p>
        </div>
      )}
    </div>
  );
}
