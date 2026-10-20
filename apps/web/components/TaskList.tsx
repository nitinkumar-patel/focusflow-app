"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { startTimerAction } from "@/app/(app)/focus/actions";
import type { Task } from "@/app/(app)/tasks/actions";

const PRIORITY_LABELS: Record<Task["priority"], string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

// `runningTaskId` is the active timer's task in ANY phase (work or
// break) — the server allows one timer at a time, so every other row's
// start control is disabled and names the running task (AC29, AC30, AC43).
export function TaskList({
  tasks,
  runningTaskId,
}: {
  tasks: Task[];
  runningTaskId: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (tasks.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-surface px-4 py-8 text-center text-muted-foreground">
        You don&apos;t have any tasks yet. Add one above to start tracking focus time.
      </p>
    );
  }

  const runningTask = runningTaskId ? tasks.find((t) => t.id === runningTaskId) : undefined;

  function start(taskId: string) {
    setError(null);
    startTransition(async () => {
      const result = await startTimerAction(taskId);
      if (result.ok) {
        router.push("/focus");
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <>
      {error ? <p role="alert" className="mb-3 text-sm text-danger">{error}</p> : null}
      <ul className="flex flex-col gap-4">
        {tasks.map((task) => {
          const isRunning = task.id === runningTaskId;
          const otherRunning = runningTaskId !== null && !isRunning;
          return (
            <li
              key={task.id}
              data-in-progress={isRunning ? "true" : "false"}
              className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 data-[in-progress=true]:border-primary data-[in-progress=true]:ring-2 data-[in-progress=true]:ring-primary sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-2">
                <span className="break-words text-base font-medium text-foreground">{task.title}</span>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                      task.priority === "high" ? "border-danger text-danger" : "border-border text-muted-foreground"
                    }`}
                  >
                    Priority: {PRIORITY_LABELS[task.priority]}
                  </span>
                  <span className="tabular-nums">
                    Pomodoros: {task.completed_pomodoros}/{task.estimated_pomodoros}
                  </span>
                  <span aria-hidden="true" className="flex items-center gap-1">
                    {Array.from({ length: task.estimated_pomodoros }, (_, i) => (
                      <span
                        key={i}
                        className={`h-1.5 w-3 rounded-full ${i < task.completed_pomodoros ? "bg-primary" : "bg-border"}`}
                      />
                    ))}
                  </span>
                  {isRunning ? <span className="font-medium text-foreground">In progress</span> : null}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-3">
                {otherRunning ? (
                  <span className="break-words text-sm text-muted-foreground">
                    Running: {runningTask?.title ?? "another task"}
                  </span>
                ) : null}
                <button
                  type="button"
                  disabled={runningTaskId !== null || isPending}
                  onClick={() => start(task.id)}
                  aria-label={`Start ${task.title}`}
                  className="rounded-md border border-border bg-background px-4 py-1.5 text-sm font-medium text-foreground hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Start
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
