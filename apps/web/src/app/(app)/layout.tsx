import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { AssistantShell } from "@/components/assistant/AssistantShell";

// アプリの枠：どのページにも、右端にチャット、下に入力欄（ファクトリー全体で1つのチャット）
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const open = (await cookies()).get("pf_chat")?.value !== "closed";
  return <AssistantShell initialOpen={open}>{children}</AssistantShell>;
}
