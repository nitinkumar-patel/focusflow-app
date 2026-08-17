import type { Task } from "@/app/(app)/tasks/actions";

// Per-task "Start focus session" control lands in T12 — a contextual
// row action, not a second primary action (AC13).
export function TaskList({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) {
    return <p>You don&apos;t have any tasks yet. Add one above to start tracking focus time.</p>;
  }

  return (
    <ul>
      {tasks.map((task) => (
        <li key={task.id}>{task.title}</li>
      ))}
    </ul>
  );
}
