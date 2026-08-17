import { SignUpForm } from "@/components/SignUpForm";

export default function SignUpPage() {
  return (
    <main>
      <h1>Sign up</h1>
      <SignUpForm />
      <p>
        Already have an account? <a href="/login">Log in</a>
      </p>
    </main>
  );
}
