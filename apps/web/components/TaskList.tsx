import type { Task } from "@/app/(app)/tasks/actions";
import type { DurationsSeconds } from "@/lib/pomodoro-durations";

import { PomodoroTimer } from "./PomodoroTimer";

export function TaskList({
  tasks,
  durationsSeconds,
}: {
  tasks: Task[];
  durationsSeconds: DurationsSeconds;
}) {
  if (tasks.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-surface px-4 py-8 text-center text-muted-foreground">
        You don&apos;t have any tasks yet. Add one above to start tracking focus time.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-4">
      {tasks.map((task) => (
        <li
          key={task.id}
          className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 has-[[data-running=true]]:border-primary has-[[data-running=true]]:ring-2 has-[[data-running=true]]:ring-primary"
        >
          <span className="break-words text-lg font-medium text-foreground">{task.title}</span>
          <PomodoroTimer taskId={task.id} durationsSeconds={durationsSeconds} />
        </li>
      ))}
    </ul>
  );
}
