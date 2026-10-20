"use client";

import { useActionState } from "react";

import { createTaskAction, type CreateTaskFormState } from "@/app/(app)/tasks/actions";

const FIELD_CLASS =
  "h-10 w-full rounded-md border border-border bg-background px-3 text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary";

const initialState: CreateTaskFormState = {};

// The screen's one primary action (AC13) — "Add task". `noValidate`: the
// server action owns range validation, so an out-of-range estimate reaches
// it and renders in the role="alert" element (AC27) instead of being
// stopped by the browser's native tooltip. createTaskAction
// already filters an unsafe error down to display-safe copy before
// returning (see its comment) — nothing to filter here.
export function TaskForm() {
  const [state, formAction, isPending] = useActionState(createTaskAction, initialState);

  return (
    <form action={formAction} noValidate className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="flex-1">
        <label htmlFor="title" className="block text-sm font-medium text-foreground mb-1">New task</label>
        <input
          id="title"
          name="title"
          type="text"
          maxLength={200}
          required
          className={FIELD_CLASS}
        />
      </div>
      <div>
        <label htmlFor="priority" className="block text-sm font-medium text-foreground mb-1">Priority</label>
        <select
          id="priority"
          name="priority"
          defaultValue="medium"
          className={FIELD_CLASS}
        >
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>
      <div>
        <label htmlFor="estimated_pomodoros" className="block text-sm font-medium text-foreground mb-1">Expected Pomodoros</label>
        <input
          id="estimated_pomodoros"
          name="estimated_pomodoros"
          type="number"
          inputMode="numeric"
          min={1}
          max={20}
          step={1}
          defaultValue={1}
          className={`${FIELD_CLASS} sm:w-28`}
        />
      </div>
      <button type="submit" disabled={isPending} className="h-10 rounded-md bg-primary px-4 font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60 disabled:cursor-not-allowed">
        Add task
      </button>
      {state.error ? <p role="alert" className="basis-full text-sm text-danger">{state.error}</p> : null}
    </form>
  );
}
