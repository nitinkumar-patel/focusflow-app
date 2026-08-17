import { TaskForm } from "@/components/TaskForm";
import { TaskList } from "@/components/TaskList";

import { getTasks } from "./actions";

export default async function TasksPage() {
  const tasks = await getTasks();

  return (
    <div>
      <h1>Tasks</h1>
      <TaskForm />
      <TaskList tasks={tasks} />
    </div>
  );
}
