import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Github } from "lucide-react";
import { agent, AgentError, type Overview } from "@/lib/agent";
import { auth } from "@/lib/auth";
import { DevRoom } from "@/components/dev/DevRoom";
import type { WsView } from "./actions";

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

  if (sp.edit) {
    return (
      <div className="mx-auto max-w-xl px-8 py-16">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900 text-white"><Github size={18} /></div>
          <div>
            <h1 className="text-xl font-semibold">GitHub につなぐ</h1>
            <p className="text-[13px] text-zinc-500">つなぐと、開発の作業場のコードを GitHub に写します（作業場が空で GitHub に中身があれば、作業場に取り込みます）。つないだあとも作業場は使い続けます。</p>
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
            写すには、そのリポジトリに書き込めるトークン（contents の書き込み）が要ります（テナントの設定か、Secret Manager の GITHUB_TOKEN）。
            作業場から GitHub への一方向で写し、GitHub 側に作業場にない変更があれば上書きせずに止めます。空にして保存すると、つなぎを外します（作業場はそのまま残ります）。
          </p>
          <div className="flex items-center gap-2"><button className="btn-primary">つなぐ</button><Link href={`/p/${id}/code`} className="btn-ghost">やめる</Link></div>
        </form>
      </div>
    );
  }

  const [view, session] = await Promise.all([agent<WsView>(`/products/${id}/workspace`), auth()]);
  const canSync = session?.user?.role !== "VIEWER";
  return (
    <div className="flex h-screen flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-zinc-200 bg-white px-6 py-3">
        <h1 className="shrink-0 whitespace-nowrap text-[15px] font-semibold">開発</h1>
        <span className="text-[11.5px] text-zinc-500">⑫の担当が、⑨のユニットごとに開発の作業場へ書いているコードを見ます。作業場が原本で、GitHub につなぐとそこに写します。</span>
      </header>
      <div className="min-h-0 flex-1 p-3"><DevRoom pid={id} initial={view} ide={!!process.env.IDE_ORIGIN} canSync={canSync} /></div>
    </div>
  );
}
