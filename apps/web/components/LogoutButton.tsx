import { logoutAction } from "@/app/(app)/actions";

// Server Component — no client JS needed. The Server Action itself
// lives in the sibling app/(app)/actions.ts, not inlined here (see
// that file's comment on why).
export function LogoutButton() {
  return (
    <form action={logoutAction}>
      <button type="submit">Log out</button>
    </form>
  );
}
