"use client";

import { useActionState } from "react";

import { signUpAction, type SignUpFormState } from "@/app/(auth)/signup/actions";

const initialState: SignUpFormState = {};

export function SignUpForm() {
  const [state, formAction, isPending] = useActionState(signUpAction, initialState);

  return (
    <form action={formAction}>
      <div>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div>
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          required
        />
      </div>
      {state.error ? <p role="alert">{state.error}</p> : null}
      <button type="submit" disabled={isPending}>
        Sign up
      </button>
    </form>
  );
}
