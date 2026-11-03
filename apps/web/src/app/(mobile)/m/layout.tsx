import { redirect } from "next/navigation";
import { agent, type Product } from "@/lib/agent";
import { auth } from "@/lib/auth";
import { MobileShell } from "@/components/mobile/MobileShell";

// スマホ専用の骨組み（middleware がスマホのときだけ、同じ URL のままここに回す）
export default async function MobileLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const products = await agent<Product[]>("/products").catch(() => [] as Product[]);
  return <MobileShell products={products.map((p) => ({ id: p.id, name: p.name }))}>{children}</MobileShell>;
}
