"use server";

import { revalidatePath } from "next/cache";

import { apiFetch } from "@/lib/api-client";
import { auth } from "@/lib/auth";

export interface Task {
  id: string;
  title: string;
  created_at: string;
}

// AC16: the user id sent to apps/api comes only from the validated
// session read here — never from a function parameter or form field.
export async function getTasks(): Promise<Task[]> {
  const session = await auth();
  if (!session?.user?.id) {
    return [];
  }

  const result = await apiFetch<Task[]>("/tasks", { userId: session.user.id });
  return result.ok ? result.data : [];
}

export interface CreateTaskFormState {
  error?: string;
}

export async function createTaskAction(
  _prevState: CreateTaskFormState,
  formData: FormData,
): Promise<CreateTaskFormState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "You must be logged in." };
  }

  const title = formData.get("title");
  if (typeof title !== "string" || !title.trim()) {
    return { error: "Task title is required." };
  }

  const result = await apiFetch<Task>("/tasks", {
    method: "POST",
    userId: session.user.id,
    body: { title },
  });

  if (!result.ok) {
    return { error: result.error };
  }

  revalidatePath("/tasks");
  return {};
}

export interface PomodoroSession {
  id: string;
  task_id: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
}

export interface RecordSessionResult {
  ok: boolean;
  error?: string;
}

// Called by PomodoroTimer when a work interval finishes naturally — see
// AC6/AC7 (never called for a break, never called on early stop).
export async function recordSessionAction(
  taskId: string,
  startedAt: string,
  endedAt: string,
  durationSeconds: number,
): Promise<RecordSessionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be logged in." };
  }

  const result = await apiFetch<PomodoroSession>(`/tasks/${taskId}/sessions`, {
    method: "POST",
    userId: session.user.id,
    body: { started_at: startedAt, ended_at: endedAt, duration_seconds: durationSeconds },
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  // The timer lives on /tasks; the chart lives on /analytics — a
  // completed session changes what both would show.
  revalidatePath("/tasks");
  revalidatePath("/analytics");
  return { ok: true };
}
