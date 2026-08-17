import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { apiFetch } from "./api-client";

// AC18: bounded session lifetime. NextAuth v5 infers its signing secret
// from AUTH_SECRET (or the legacy NEXTAUTH_SECRET alias) automatically —
// see the framework-currency note in plan.md T9's Approach.
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

interface VerifyResponse {
  id: string;
  email: string;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Self-hosted behind our own Nginx (not an auto-trusted platform like
  // Vercel) — Auth.js needs explicit permission to trust the forwarded
  // Host header Nginx sets (apps/nginx/nginx.conf). Safe here because
  // T1's forwarded-header config (AC21) is the thing making the Host
  // header trustworthy in the first place.
  trustHost: true,
  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") {
          return null;
        }

        // Never log or rethrow the raw password on this path — AC11,
        // web half. apiFetch itself never includes it in an error.
        const result = await apiFetch<VerifyResponse>("/auth/verify", {
          method: "POST",
          body: { email, password },
        });
        if (!result.ok) {
          return null;
        }
        return { id: result.data.id, email: result.data.email };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && typeof token.id === "string") {
        session.user.id = token.id;
      }
      return session;
    },
  },
});
