import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth.config";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isPublic = ["/login", "/register", "/api/auth"].some((p) => pathname.startsWith(p));
  if (!req.auth && !isPublic) {
    const url = new URL("/login", req.url);
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
});

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
