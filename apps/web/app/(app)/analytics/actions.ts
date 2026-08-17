"use server";

import { apiFetch } from "@/lib/api-client";
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

const EMPTY: FocusTimeResponse = { by_day: [], by_task: [] };

// AC16: the user id sent to apps/api comes only from the validated
// session read here.
export async function getFocusTime(): Promise<FocusTimeResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return EMPTY;
  }

  const result = await apiFetch<FocusTimeResponse>("/analytics/focus-time", {
    userId: session.user.id,
  });
  return result.ok ? result.data : EMPTY;
}
