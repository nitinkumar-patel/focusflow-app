"use client";

import { useActionState } from "react";

import { loginAction, type LoginFormState } from "@/app/(auth)/login/actions";

const initialState: LoginFormState = {};

export function LoginForm() {
  const [state, formAction, isPending] = useActionState(loginAction, initialState);

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
          autoComplete="current-password"
          required
        />
      </div>
      {state.error ? <p role="alert">{state.error}</p> : null}
      <button type="submit" disabled={isPending}>
        Log in
      </button>
    </form>
  );
}
