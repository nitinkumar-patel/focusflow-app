import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/app/(app)/focus/actions", () => ({
  startTimerAction: vi.fn().mockResolvedValue({ ok: true, timer: {} }),
}));

import { startTimerAction } from "@/app/(app)/focus/actions";
import type { Task } from "@/app/(app)/tasks/actions";

import { TaskList } from "./TaskList";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

const tasks: Task[] = [
  { id: A, title: "Alpha", created_at: "2026-01-03T00:00:00Z", priority: "high", estimated_pomodoros: 4, completed_pomodoros: 2 },
  { id: B, title: "Bravo", created_at: "2026-01-02T00:00:00Z", priority: "medium", estimated_pomodoros: 1, completed_pomodoros: 0 },
  { id: C, title: "Charlie", created_at: "2026-01-01T00:00:00Z", priority: "low", estimated_pomodoros: 3, completed_pomodoros: 3 },
];

describe("TaskList", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows priority and completed/estimated per row, in the given order (AC28)", () => {
    render(<TaskList tasks={tasks} runningTaskId={null} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => r.querySelector("span")?.textContent)).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(rows[0].textContent).toContain("High");
    expect(rows[0].textContent).toContain("2/4");
    expect(rows[1].textContent).toContain("Medium");
    expect(rows[1].textContent).toContain("0/1");
    expect(rows[2].textContent).toContain("Low");
    expect(rows[2].textContent).toContain("3/3");
  });

  it("enables every start control and shows no running text when idle", () => {
    render(<TaskList tasks={tasks} runningTaskId={null} />);
    for (const b of screen.getAllByRole("button")) expect((b as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/Running:/)).toBeNull();
  });

  it("starts the timer and navigates to /focus", async () => {
    render(<TaskList tasks={tasks} runningTaskId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Start Bravo" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/focus"));
    expect(startTimerAction).toHaveBeenCalledWith(B);
  });

  it("shows an alert and stays put when start fails", async () => {
    vi.mocked(startTimerAction).mockResolvedValueOnce({ ok: false, error: "A timer is already running." });
    render(<TaskList tasks={tasks} runningTaskId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Start Bravo" }));
    expect((await screen.findByRole("alert")).textContent).toContain("already running");
    expect(push).not.toHaveBeenCalled();
  });

  // The page passes the active timer's task id regardless of phase, so
  // each phase maps to the same prop; the cases pin that for all three.
  it.each(["work", "short_break", "long_break"])(
    "marks the running row, disables the others and names the running task (%s) (AC29, AC30, AC43)",
    () => {
      render(<TaskList tasks={tasks} runningTaskId={B} />);
      const rows = screen.getAllByRole("listitem");
      expect(rows.map((r) => r.getAttribute("data-in-progress"))).toEqual(["false", "true", "false"]);
      expect(rows[1].textContent).toContain("In progress");
      for (const i of [0, 2]) {
        expect(rows[i].querySelector("button")?.disabled).toBe(true);
        expect(rows[i].textContent).toContain("Running: Bravo");
      }
      expect(rows[1].querySelector("button")?.disabled).toBe(true);
      expect(rows[1].textContent).not.toContain("Running:");
    },
  );
});
