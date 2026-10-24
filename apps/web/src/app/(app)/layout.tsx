import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }
  return (
    <div className="min-h-screen">
      <header className="flex h-12 items-center justify-between bg-deep px-4 text-white">
        <Link href="/" className="font-bold">Product Factory</Link>
        <div className="flex items-center gap-4 text-sm text-teal-light">
          <span>{session.user.email}（{session.user.role ?? "-"}・{session.user.mode === "corporate" ? "法人" : "個人"}モード）</span>
          <form action={logout}><button className="underline">ログアウト</button></form>
        </div>
      </header>
      {children}
    </div>
  );
}
