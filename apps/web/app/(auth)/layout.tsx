import { SiteHeader } from "@/components/SiteHeader";

// Auth screens get the same top bar as the app shell, without navigation.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      {children}
    </>
  );
}
