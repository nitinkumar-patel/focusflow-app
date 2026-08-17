"use server";

import { auth, signOut } from "@/lib/auth";

// AC18: ends the session; a subsequent request to /tasks then hits the
// proxy.ts redirect to /login. Kept in this sibling actions.ts (not
// inlined in LogoutButton) so AC16's grep check — which only scans
// actions.ts files — stays exhaustive rather than a spot-check.
export async function logoutAction(): Promise<void> {
  await auth();
  await signOut({ redirectTo: "/login" });
}
