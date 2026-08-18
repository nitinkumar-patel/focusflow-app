"use client";

import { useActionState } from "react";

import { createTaskAction, type CreateTaskFormState } from "@/app/(app)/tasks/actions";

const initialState: CreateTaskFormState = {};

// The screen's one primary action (AC13) — "Add task". createTaskAction
// already filters an unsafe error down to display-safe copy before
// returning (see its comment) — nothing to filter here.
export function TaskForm() {
  const [state, formAction, isPending] = useActionState(createTaskAction, initialState);

  return (
    <form action={formAction}>
      <label htmlFor="title">New task</label>
      <input id="title" name="title" type="text" maxLength={200} required />
      {state.error ? <p role="alert">{state.error}</p> : null}
      <button type="submit" disabled={isPending}>
        Add task
      </button>
    </form>
  );
}
