import { FocusTimer } from "@/components/FocusTimer";
import { safeErrorMessage } from "@/lib/api-client";

import { getTasks } from "../tasks/actions";
import { getTimerAction } from "./actions";

export default async function FocusPage() {
  const timer = await getTimerAction();

  let taskTitle: string | null = null;
  if (timer.ok && timer.data) {
    const tasks = await getTasks();
    taskTitle = tasks.ok ? (tasks.data.find((t) => t.id === timer.data?.task_id)?.title ?? null) : null;
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Focus</h1>
      {timer.ok ? (
        <FocusTimer initialTimer={timer.data} taskTitle={taskTitle} />
      ) : (
        <p role="alert" className="text-sm text-danger">{safeErrorMessage(timer)}</p>
      )}
    </div>
  );
}
