import { signOut } from "@/lib/auth";

// Server Component with an inline Server Action — no client JS needed.
// AC18: ends the session; a subsequent request to /tasks then hits the
// proxy.ts redirect to /login.
export function LogoutButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    >
      <button type="submit">Log out</button>
    </form>
  );
}
