import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { auth } from "@/lib/auth";
import { AssistantShell } from "@/components/assistant/AssistantShell";
import { ToMobile } from "@/components/mobile/ToMobile";
import { isMobileUa } from "@/lib/mobile";

// アプリの枠：どのページにも、右端にチャット、下に入力欄（ファクトリー全体で1つのチャット）
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const jar = await cookies();
  const open = jar.get("pf_chat")?.value !== "closed";
  // スマホで PC 版を選んでいるときは、スマホ版に戻すボタンを出す（スマホ版は middleware が /m に回す）
  const phone = isMobileUa((await headers()).get("user-agent")) && jar.get("pf_view")?.value === "pc";
  return <><AssistantShell initialOpen={open}>{children}</AssistantShell>{phone && <ToMobile />}</>;
}
