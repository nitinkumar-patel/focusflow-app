"use server";

import { redirect } from "next/navigation";

import { auth, signOut } from "@/lib/auth";

// AC18: ends the session; a subsequent request to /tasks then hits the
// proxy.ts redirect to /login. Kept in this sibling actions.ts (not
// inlined in LogoutButton) so AC16's grep check — which only scans
// actions.ts files — stays exhaustive rather than a spot-check. The
// session check below is a real branch (round-2 REVIEW finding: an
// earlier version called `auth()` and discarded the result, which the
// grep couldn't distinguish from a load-bearing check) — an already-
// logged-out caller redirects without invoking NextAuth's signOut
// machinery against a session that isn't there.
export async function logoutAction(): Promise<void> {
  const session = await auth();
  if (!session) {
    redirect("/login");
  }
  await signOut({ redirectTo: "/login" });
}
