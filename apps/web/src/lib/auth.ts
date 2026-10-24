import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { findUserByEmail, latestMembership } from "./db";
import { authConfig } from "./auth.config";

// テナントIDとロールはサーバー側でセッションに載せる。
// API に渡すテナントは常にこの値だけを使い、リクエスト本文の値は使わない（設計書 10.1）。
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      tenantId: string | null;
      role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER" | null;
      mode: string | null;
    };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: { type: "email" }, password: { type: "password" } },
      async authorize(credentials) {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;
        const user = await findUserByEmail(email);
        if (!user?.password) return null;
        if (!(await bcrypt.compare(password, user.password))) return null;
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    async session({ session, token }) {
      if (token?.sub) {
        const m = await latestMembership(token.sub);
        session.user.id = token.sub;
        session.user.tenantId = m?.tenant_id ?? null;
        session.user.role = m?.role ?? null;
        session.user.mode = m?.mode ?? null;
      }
      return session;
    },
  },
});

