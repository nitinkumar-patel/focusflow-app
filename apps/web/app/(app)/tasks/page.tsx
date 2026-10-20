import { TaskForm } from "@/components/TaskForm";
import { TaskList } from "@/components/TaskList";
import { safeErrorMessage } from "@/lib/api-client";
import { resolveDurations } from "@/lib/pomodoro-durations";

import { getTasks } from "./actions";

// This is the only place POMODORO_TEST_SHORT_INTERVALS is read — it
// never reaches PomodoroTimer (a Client Component) as anything but the
// already-resolved numbers, so the raw override string never ships to
// the browser (plan.md's Design decisions).
export default async function TasksPage() {
  const result = await getTasks();
  const durationsSeconds = resolveDurations(process.env.POMODORO_TEST_SHORT_INTERVALS);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-foreground">Tasks</h1>
      <TaskForm />
      {result.ok ? (
        <TaskList tasks={result.data} durationsSeconds={durationsSeconds} />
      ) : (
        <p role="alert" className="text-sm text-danger">{safeErrorMessage(result)}</p>
      )}
    </div>
  );
}
