import { SignUpForm } from "@/components/SignUpForm";

export default function SignUpPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 shadow-sm sm:p-8">
        <h1 className="mb-6 text-2xl font-semibold text-foreground">Sign up</h1>
        <SignUpForm />
        <p className="mt-6 text-sm text-muted-foreground">
          Already have an account?{" "}
          <a
            href="/login"
            className="font-medium text-accent underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Log in
          </a>
        </p>
      </div>
    </main>
  );
}
