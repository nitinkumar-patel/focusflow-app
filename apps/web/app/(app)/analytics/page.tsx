import { FocusTimeChart } from "@/components/FocusTimeChart";

import { getFocusTime } from "./actions";

// Read-only screen — no primary action control (AC13).
export default async function AnalyticsPage() {
  const { by_day: byDay, by_task: byTask } = await getFocusTime();

  if (byTask.length === 0) {
    return (
      <div>
        <h1>Analytics</h1>
        <p>
          No focus time recorded yet. Run a Pomodoro session against a task to see it here.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1>Analytics</h1>
      <FocusTimeChart byDay={byDay} />
      <ul>
        {byTask.map((task) => (
          <li key={task.task_id}>
            {task.task_title}: {task.minutes} min
          </li>
        ))}
      </ul>
    </div>
  );
}
