import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 shadow-sm sm:p-8">
        <h1 className="mb-6 text-2xl font-semibold text-foreground">Log in</h1>
        <LoginForm />
        <p className="mt-6 text-sm text-muted-foreground">
          Need an account?{" "}
          <a
            href="/signup"
            className="font-medium text-accent underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Sign up
          </a>
        </p>
      </div>
    </main>
  );
}
