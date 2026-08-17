import Link from "next/link";

import { LogoutButton } from "@/components/LogoutButton";

// Shared authenticated shell for /tasks and /analytics. The nav links
// and "Log out" control here are layout chrome, not either screen's
// primary action — they don't count against AC13's one-primary-action
// limit (spec AC13).
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <nav>
        <Link href="/tasks">Tasks</Link>
        <Link href="/analytics">Analytics</Link>
        <LogoutButton />
      </nav>
      <main>{children}</main>
    </div>
  );
}
