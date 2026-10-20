import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/tasks/actions", () => ({
  createTaskAction: vi.fn().mockResolvedValue({ error: "Estimated Pomodoros must be a whole number from 1 to 20." }),
}));

import { fireEvent, waitFor } from "@testing-library/react";

import { TaskForm } from "./TaskForm";

describe("TaskForm", () => {
  afterEach(cleanup);

  it("labels the priority and expected-Pomodoros fields (AC26)", () => {
    render(<TaskForm />);
    const priority = screen.getByLabelText("Priority") as HTMLSelectElement;
    expect(priority.tagName).toBe("SELECT");
    expect(priority.name).toBe("priority");
    const est = screen.getByLabelText("Expected Pomodoros") as HTMLInputElement;
    expect(est.type).toBe("number");
    expect(est.name).toBe("estimated_pomodoros");
  });

  it("leaves range validation to the server action so the alert is reachable (AC27)", () => {
    render(<TaskForm />);
    const form = screen.getByRole("button", { name: "Add task" }).closest("form")!;
    // Without noValidate a real browser blocks min/max violations before
    // the action runs, so no role=alert could ever render.
    expect(form.noValidate).toBe(true);
  });

  it("renders an out-of-range estimate error in a role=alert element (AC27)", async () => {
    render(<TaskForm />);
    fireEvent.change(screen.getByLabelText("New task"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("Expected Pomodoros"), { target: { value: "99" } });
    fireEvent.submit(screen.getByRole("button", { name: "Add task" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("1 to 20"));
  });
});
