import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";

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
    <main className="mx-auto mt-24 max-w-sm">
      <h1 className="mb-6 text-2xl font-bold text-deep">Product Factory</h1>
      <form action={login} className="card space-y-3">
        <input name="email" type="email" required placeholder="メールアドレス" className="input" />
        <input name="password" type="password" required placeholder="パスワード" className="input" />
        {sp.error && <p className="text-sm text-amber">メールアドレスかパスワードが違います</p>}
        <button className="btn-primary w-full justify-center">ログイン</button>
      </form>
      <p className="mt-4 text-sm text-muted">
        アカウントがない場合は <Link href="/register" className="text-teal underline">登録</Link>
      </p>
    </main>
  );
}
