"use server";

import { revalidatePath } from "next/cache";

import { apiFetch, safeErrorMessage, type ApiResult } from "@/lib/api-client";
import { auth } from "@/lib/auth";

export interface Timer {
  task_id: string;
  phase: "work" | "short_break" | "long_break";
  started_at: string;
  ends_at: string;
  duration_seconds: number;
  remaining_seconds: number;
  server_time: string;
  cycle_position: number;
}

export type StartTimerResult = { ok: true; timer: Timer } | { ok: false; error: string };
export type StopTimerResult = { ok: true } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_LOGGED_IN = "You must be logged in.";

// The user id comes only from the validated session (AC16); the server
// owns cadence and durations, so no timing value is accepted here.
export async function startTimerAction(taskId: string): Promise<StartTimerResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: NOT_LOGGED_IN };
  }
  // Defense in depth — a Server Action argument is as client-controlled
  // as a form field.
  if (typeof taskId !== "string" || !UUID_RE.test(taskId)) {
    return { ok: false, error: "Invalid task." };
  }

  const result = await apiFetch<Timer>("/timer/start", {
    method: "POST",
    userId: session.user.id,
    body: { task_id: taskId },
  });
  if (!result.ok) {
    // Filtered before returning — never hand apps/api's raw detail to the client.
    if (result.status === 409) return { ok: false, error: "A timer is already running." };
    if (result.status === 404) return { ok: false, error: "Task not found." };
    return { ok: false, error: safeErrorMessage(result) };
  }

  revalidatePath("/tasks");
  revalidatePath("/focus");
  return { ok: true, timer: result.data };
}

// `data` is null when no timer is running. Like getTasks, returns the
// typed result so a caller can tell "no timer" from a failed fetch.
export async function getTimerAction(): Promise<ApiResult<Timer | null>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: NOT_LOGGED_IN, safe: true };
  }
  return apiFetch<Timer | null>("/timer", { userId: session.user.id });
}

export async function stopTimerAction(): Promise<StopTimerResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: NOT_LOGGED_IN };
  }

  const result = await apiFetch<undefined>("/timer/stop", {
    method: "POST",
    userId: session.user.id,
  });
  if (!result.ok) {
    if (result.status === 404) return { ok: false, error: "No timer is running." };
    return { ok: false, error: safeErrorMessage(result) };
  }

  revalidatePath("/tasks");
  revalidatePath("/focus");
  revalidatePath("/analytics");
  return { ok: true };
}
