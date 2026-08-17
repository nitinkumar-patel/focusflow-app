import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <main>
      <h1>Log in</h1>
      <LoginForm />
      <p>
        Need an account? <a href="/signup">Sign up</a>
      </p>
    </main>
  );
}
