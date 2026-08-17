"use server";

import { apiFetch, type ApiResult } from "@/lib/api-client";
import { auth } from "@/lib/auth";

export interface FocusTimeByDay {
  date: string;
  minutes: number;
}

export interface FocusTimeByTask {
  task_id: string;
  task_title: string;
  minutes: number;
}

export interface FocusTimeResponse {
  by_day: FocusTimeByDay[];
  by_task: FocusTimeByTask[];
}

// AC16: the user id sent to apps/api comes only from the validated
// session read here. Returns the typed result (not a bare fallback) so
// the page can tell a genuinely empty response apart from a failed
// fetch (AC9) instead of showing the empty-state copy for both.
export async function getFocusTime(): Promise<ApiResult<FocusTimeResponse>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be logged in." };
  }

  return apiFetch<FocusTimeResponse>("/analytics/focus-time", { userId: session.user.id });
}
