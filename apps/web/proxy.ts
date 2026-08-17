// Next.js 16 renamed the middleware.ts file convention to proxy.ts —
// see plan.md's framework-currency note. This is the AC12 UX
// convenience redirect only; it is not the authorization boundary
// (AC16) — every Server Action independently checks the session too.
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";

export default auth((req) => {
  const isProtectedRoute =
    req.nextUrl.pathname.startsWith("/tasks") ||
    req.nextUrl.pathname.startsWith("/analytics");

  if (isProtectedRoute && !req.auth) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }
});

export const config = {
  matcher: ["/tasks/:path*", "/analytics/:path*"],
};
