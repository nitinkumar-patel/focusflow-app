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
    return <p>You don&apos;t have any tasks yet. Add one above to start tracking focus time.</p>;
  }

  return (
    <ul>
      {tasks.map((task) => (
        <li key={task.id}>
          {task.title}{" "}
          <PomodoroTimer taskId={task.id} durationsSeconds={durationsSeconds} />
        </li>
      ))}
    </ul>
  );
}
