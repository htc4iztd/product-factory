import type { NextAuthConfig } from "next-auth";

// Edge（middleware）でも動く軽量な設定。DB アクセスを含めない。
export const authConfig: NextAuthConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  trustHost: true,
  providers: [],
};
