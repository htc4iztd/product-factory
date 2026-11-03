import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth.config";
import { isMobile } from "@/lib/mobile";

const { auth } = NextAuth(authConfig);

// スマホのときは、同じ URL のまま、スマホ専用の骨組み（/m 以下）を出す（lib/mobile の isMobile で決める）
const NO_REWRITE = ["/m", "/api", "/login", "/register", "/ide", "/_next", "/print"];

export default auth((req) => {
  const { pathname, search } = req.nextUrl;
  const isPublic = ["/login", "/register", "/api/auth"].some((p) => pathname.startsWith(p));
  if (!req.auth && !isPublic) {
    const url = new URL("/login", req.url);
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }
  const skip = NO_REWRITE.some((p) => pathname === p || pathname.startsWith(p + "/")) || /\.[a-z0-9]+$/i.test(pathname);
  if (!skip && isMobile(req.headers.get("user-agent"), req.cookies.get("pf_view")?.value)) {
    return NextResponse.rewrite(new URL(`/m${pathname === "/" ? "" : pathname}${search}`, req.url));
  }
  return NextResponse.next();
});

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
