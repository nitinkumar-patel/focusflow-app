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
    <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1">
        <label htmlFor="title" className="block text-sm font-medium text-foreground mb-1">New task</label>
        <input
          id="title"
          name="title"
          type="text"
          maxLength={200}
          required
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary"
        />
        {state.error ? <p role="alert" className="mt-1 text-sm text-danger">{state.error}</p> : null}
      </div>
      <button type="submit" disabled={isPending} className="rounded-md bg-primary px-4 py-2 font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60 disabled:cursor-not-allowed">
        Add task
      </button>
    </form>
  );
}
