import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";
import { Logo } from "@/components/Logo";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; callbackUrl?: string }> }) {
  const sp = await searchParams;
  async function login(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirectTo: sp.callbackUrl || "/",
      });
    } catch (e) {
      if (e instanceof AuthError) redirect("/login?error=1");
      throw e;
    }
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,_#eef0fe,_#fafafa_60%)] px-4">
      <div className="w-full max-w-sm">
      <div className="mb-8 flex justify-center"><Logo /></div>
        <h1 className="mb-1 text-center text-lg font-semibold">ログイン</h1>
        <p className="mb-6 text-center text-[13px] text-zinc-500">アイデアから運用までを、ひとつの場所で。</p>
      <form action={login} className="card space-y-3 p-6">
        <input name="email" type="email" required placeholder="メールアドレス" className="input" />
        <input name="password" type="password" required placeholder="パスワード" className="input" />
        {sp.error && <p className="text-xs text-rose-600">メールアドレスかパスワードが違います</p>}
        <button className="btn-primary h-9 w-full">ログイン</button>
      </form>
      <p className="mt-4 text-center text-[13px] text-zinc-500">
        アカウントがない場合は <Link href="/register" className="font-medium text-brand-700 hover:underline">登録</Link>
      </p>
      </div>
    </main>
  );
}
