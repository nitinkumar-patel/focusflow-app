import { TaskForm } from "@/components/TaskForm";
import { TaskList } from "@/components/TaskList";
import { safeErrorMessage } from "@/lib/api-client";

import { getTimerAction } from "../focus/actions";
import { getTasks } from "./actions";

export default async function TasksPage() {
  const [result, timer] = await Promise.all([getTasks(), getTimerAction()]);
  // A failed timer fetch degrades to "no timer": the API still rejects a
  // second start with 409, which the list surfaces.
  const runningTaskId = timer.ok && timer.data ? timer.data.task_id : null;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Tasks</h1>
      <TaskForm />
      {result.ok ? (
        <TaskList tasks={result.data} runningTaskId={runningTaskId} />
      ) : (
        <p role="alert" className="text-sm text-danger">{safeErrorMessage(result)}</p>
      )}
    </div>
  );
}
