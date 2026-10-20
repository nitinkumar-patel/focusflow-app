import { logoutAction } from "@/app/(app)/actions";

// Server Component — no client JS needed. The Server Action itself
// lives in the sibling app/(app)/actions.ts, not inlined here (see
// that file's comment on why).
export function LogoutButton() {
  return (
    <form action={logoutAction}>
      <button
        type="submit"
        className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        Log out
      </button>
    </form>
  );
}
