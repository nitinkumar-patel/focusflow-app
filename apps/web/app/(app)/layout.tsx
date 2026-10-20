import { AppNav } from "@/components/AppNav";
import { LogoutButton } from "@/components/LogoutButton";
import { SiteHeader } from "@/components/SiteHeader";

// Shared authenticated shell for /tasks, /focus and /analytics. The nav
// links and "Log out" control are layout chrome, not any screen's
// primary action — they don't count against walking-skeleton AC13's
// one-primary-action limit.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader nav={<AppNav />} actions={<LogoutButton />} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </>
  );
}
