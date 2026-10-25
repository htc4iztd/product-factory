import { auth } from "@/lib/auth";
import { ID_TOKEN, googleIdToken } from "@/lib/agent";

// Code-OSS の Web 版（静的ファイル）を IDE 用の Cloud Run（IDE_ORIGIN）から中継する。
// 同じオリジンから配ることで、IDE 内の拡張機能がログイン中の cookie で /api/p/{id}/code を読める。
const ORIGIN = process.env.IDE_ORIGIN;

export async function GET(req: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  if (!(await auth())?.user) return new Response("unauthorized", { status: 401 });
  if (!ORIGIN) return new Response("IDE がまだ配置されていません（IDE_ORIGIN 未設定）", { status: 503 });
  const { path = [] } = await params;
  const rel = path.map(encodeURIComponent).join("/") || "index.html";
  const origin = ORIGIN.replace(/\/$/, "");
  // Cloud Run では IDE も IAM で閉じている。agent と同じく web の ID トークンを付ける
  const headers0: HeadersInit = ID_TOKEN ? { authorization: `Bearer ${await googleIdToken(origin)}` } : {};
  const upstream = await fetch(`${origin}/${rel}${new URL(req.url).search}`, { headers: headers0, cache: "no-store" });
  const headers = new Headers();
  for (const h of ["content-type", "cache-control", "etag", "last-modified"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
