import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { findUserByEmail, newId, tx } from "@/lib/db";
import { signIn } from "@/lib/auth";
import { Logo } from "@/components/Logo";

// 登録した人が自分のテナントの OWNER になる（個人モード）。
export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  async function register(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");
    const name = String(formData.get("name") ?? "").trim();
    if (!email || password.length < 8) redirect("/register?error=input");
    if (process.env.PF_ALLOW_SIGNUP === "false") redirect("/register?error=closed");
    if (await findUserByEmail(email)) redirect("/register?error=exists");
    const slug = `${email.split("@")[0].replace(/[^a-z0-9]/g, "-").slice(0, 40)}-${Date.now().toString(36)}`;
    const hash = await bcrypt.hash(password, 10);
    await tx(async (c) => {
      const userId = newId(), tenantId = newId();
      await c.query("INSERT INTO pf_user (id, email, name, password) VALUES ($1, $2, $3, $4)", [userId, email, name, hash]);
      await c.query("INSERT INTO pf_tenant (id, name, slug, mode) VALUES ($1, $2, $3, 'personal')", [tenantId, name || email, slug]);
      await c.query("INSERT INTO pf_tenant_member (id, tenant_id, user_id, role) VALUES ($1, $2, $3, 'OWNER')", [newId(), tenantId, userId]);
    });
    await signIn("credentials", { email, password, redirectTo: "/" });
  }
  const msg: Record<string, string> = {
    input: "メールアドレスと8文字以上のパスワードを入れてください",
    exists: "このメールアドレスは登録済みです",
    closed: "新規登録は締め切っています",
  };
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,_#eef0fe,_#fafafa_60%)] px-4">
      <div className="w-full max-w-sm">
      <div className="mb-8 flex justify-center"><Logo /></div>
        <h1 className="mb-1 text-center text-lg font-semibold">アカウント登録</h1>
        <p className="mb-6 text-center text-[13px] text-zinc-500">登録した人が自分のワークスペースの OWNER になります。</p>
      <form action={register} className="card space-y-3 p-6">
        <input name="name" placeholder="名前" className="input" />
        <input name="email" type="email" required placeholder="メールアドレス" className="input" />
        <input name="password" type="password" required placeholder="パスワード（8文字以上）" className="input" />
        {sp.error && <p className="text-xs text-rose-600">{msg[sp.error] ?? "登録できませんでした"}</p>}
        <button className="btn-primary h-9 w-full">登録して始める</button>
      </form>
      </div>
    </main>
  );
}
