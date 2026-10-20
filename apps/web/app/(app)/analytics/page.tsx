import { FocusTimeChart } from "@/components/FocusTimeChart";
import { safeErrorMessage } from "@/lib/api-client";

import { getFocusTime } from "./actions";

// Read-only screen — no primary action control (AC13).
export default async function AnalyticsPage() {
  const result = await getFocusTime();

  if (!result.ok) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Analytics</h1>
        <p role="alert" className="text-sm text-danger">{safeErrorMessage(result)}</p>
      </div>
    );
  }

  const { by_day: byDay, by_task: byTask } = result.data;

  if (byTask.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Analytics</h1>
        <p className="rounded-lg border border-dashed border-border bg-surface px-4 py-8 text-center text-muted-foreground">
          No focus time recorded yet. Run a Pomodoro session against a task to see it here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Analytics</h1>
      <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-lg font-medium text-foreground">Focus time per day</h2>
        <FocusTimeChart byDay={byDay} />
      </section>
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-lg font-medium text-foreground">Focus time by task</h2>
        <ul className="flex flex-col divide-y divide-border">
          {byTask.map((task) => (
            <li key={task.task_id} className="flex items-baseline justify-between gap-4 py-2 text-foreground first:pt-0 last:pb-0">
              <span className="break-words">{task.task_title}</span>
              <span className="shrink-0 text-muted-foreground">{task.minutes} min</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
