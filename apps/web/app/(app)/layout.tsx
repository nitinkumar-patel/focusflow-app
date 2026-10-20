import Link from "next/link";

import { LogoutButton } from "@/components/LogoutButton";

// Shared authenticated shell for /tasks and /analytics. The nav links
// and "Log out" control here are layout chrome, not either screen's
// primary action — they don't count against AC13's one-primary-action
// limit (spec AC13).
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <nav className="flex flex-wrap items-center gap-1 border-b border-border bg-surface px-4 pb-2 sm:px-6">
        <Link href="/tasks" className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">Tasks</Link>
        <Link href="/analytics" className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">Analytics</Link>
        <div className="ml-auto">
          <LogoutButton />
        </div>
      </nav>
      <main>{children}</main>
    </div>
  );
}
