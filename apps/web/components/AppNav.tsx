"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/tasks", label: "Tasks" },
  { href: "/focus", label: "Focus" },
  { href: "/analytics", label: "Analytics" },
] as const;

const BASE =
  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const ACTIVE = "bg-background text-foreground ring-1 ring-border";
const INACTIVE = "text-muted-foreground hover:bg-background hover:text-foreground";

// Layout chrome, not a screen's primary action (walking-skeleton AC13).
// `aria-current="page"` marks the active screen for assistive technology
// and drives its visual state.
export function AppNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="order-last flex w-full gap-1 sm:order-none sm:w-auto">
      {LINKS.map(({ href, label }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`${BASE} ${active ? ACTIVE : INACTIVE}`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
