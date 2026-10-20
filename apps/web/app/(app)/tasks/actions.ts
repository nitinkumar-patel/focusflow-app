"use server";

import { revalidatePath } from "next/cache";

import { apiFetch, safeErrorMessage, type ApiResult } from "@/lib/api-client";
import { auth } from "@/lib/auth";

export type Priority = "high" | "medium" | "low";

const PRIORITIES: readonly string[] = ["high", "medium", "low"];

export interface Task {
  id: string;
  title: string;
  created_at: string;
  priority: Priority;
  estimated_pomodoros: number;
  completed_pomodoros: number;
}

// AC16: the user id sent to apps/api comes only from the validated
// session read here — never from a function parameter or form field.
// Returns the typed result (not a bare array) so the page can tell a
// genuinely empty task list apart from a failed fetch (AC3) instead of
// showing the empty-state copy for both.
export async function getTasks(): Promise<ApiResult<Task[]>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be logged in.", safe: true };
  }

  return apiFetch<Task[]>("/tasks", { userId: session.user.id });
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

  const rawTitle = formData.get("title");
  if (typeof rawTitle !== "string") {
    return { error: "Task title is required." };
  }
  // Defense in depth (spec Boundaries § Always do) — the HTML
  // maxLength attribute only constrains a browser-driven request.
  const title = rawTitle.trim();
  if (title.length < 1 || title.length > 200) {
    return { error: "Task title must be between 1 and 200 characters." };
  }

  // Defense in depth again — priority and estimate are form fields too.
  // An absent field is omitted so the API applies its defaults
  // (medium / 1); a present-but-invalid one is rejected here.
  const body: { title: string; priority?: Priority; estimated_pomodoros?: number } = { title };

  const rawPriority = formData.get("priority");
  if (rawPriority !== null) {
    if (typeof rawPriority !== "string" || !PRIORITIES.includes(rawPriority)) {
      return { error: "Priority must be High, Medium, or Low." };
    }
    body.priority = rawPriority as Priority;
  }

  const rawEstimate = formData.get("estimated_pomodoros");
  if (rawEstimate !== null) {
    const estimate =
      typeof rawEstimate === "string" && /^\d{1,3}$/.test(rawEstimate)
        ? Number(rawEstimate)
        : NaN;
    if (!Number.isInteger(estimate) || estimate < 1 || estimate > 20) {
      return { error: "Estimated Pomodoros must be a whole number from 1 to 20." };
    }
    body.estimated_pomodoros = estimate;
  }

  const result = await apiFetch<Task>("/tasks", {
    method: "POST",
    userId: session.user.id,
    body,
  });

  if (!result.ok) {
    // Filtered here, not at render time — `useActionState` serializes
    // whatever this action returns into the page's hydration payload
    // for the next submission, so an unsafe raw string must never be
    // part of the returned state at all, not just kept out of the
    // rendered DOM (round-4 REVIEW follow-up: the render-time filter
    // alone still leaked the raw string into the page source via that
    // mechanism).
    return { error: safeErrorMessage(result) };
  }

  revalidatePath("/tasks");
  return {};
}
