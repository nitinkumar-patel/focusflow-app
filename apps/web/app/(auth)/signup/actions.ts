"use server";

import { AuthError } from "next-auth";

import { apiFetch } from "@/lib/api-client";
import { signIn } from "@/lib/auth";

export interface SignUpFormState {
  error?: string;
}

interface RegisterResponse {
  id: string;
  email: string;
}

// Pre-auth: there is no session yet to check, so this action doesn't
// call auth() (AC16 applies to Server Actions that read/mutate an
// existing user's data — creating the account isn't that).
export async function signUpAction(
  _prevState: SignUpFormState,
  formData: FormData,
): Promise<SignUpFormState> {
  const email = formData.get("email");
  const password = formData.get("password");

  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return { error: "Email and password are required." };
  }

  // Defense in depth (spec Boundaries § Always do) — the browser's
  // type="email" and minLength/maxLength attributes only constrain a
  // browser-driven request, not a direct POST to this action.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Enter a valid email address." };
  }
  if (password.length < 8 || password.length > 128) {
    return { error: "Password must be between 8 and 128 characters." };
  }

  const result = await apiFetch<RegisterResponse>("/auth/register", {
    method: "POST",
    body: { email, password },
  });

  if (!result.ok) {
    return { error: result.status === 409 ? "That email is already registered." : result.error };
  }

  try {
    await signIn("credentials", { email, password, redirectTo: "/tasks" });
  } catch (error) {
    // NextAuth's server-side signIn throws a redirect on success — only
    // a real AuthError means sign-in actually failed.
    if (error instanceof AuthError) {
      return { error: "Account created, but signing in failed. Try logging in." };
    }
    throw error;
  }

  return {};
}
