import type { ReactNode } from "react";

import { ThemeToggle } from "@/components/ThemeToggle";

// The single top bar for every screen: brand on the left, optional
// navigation (second row below `sm`), and the toggle plus any actions
// on the right. Its container width matches each layout's <main> so
// the brand and the page content share a left edge.
export function SiteHeader({ nav, actions }: { nav?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-surface">
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <span className="text-lg font-semibold tracking-tight text-foreground">FocusFlow</span>
        {nav}
        <div className="ml-auto flex items-center gap-2">
          {actions}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
