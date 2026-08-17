"use server";

import { AuthError } from "next-auth";

import { signIn } from "@/lib/auth";

export interface LoginFormState {
  error?: string;
}

// Pre-auth: no session yet to check (AC16 doesn't apply — see the
// signup action's note).
export async function loginAction(
  _prevState: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const email = formData.get("email");
  const password = formData.get("password");

  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return { error: "Email and password are required." };
  }

  try {
    await signIn("credentials", { email, password, redirectTo: "/tasks" });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Incorrect email or password." };
    }
    throw error;
  }

  return {};
}
