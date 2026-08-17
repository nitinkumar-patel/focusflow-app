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
