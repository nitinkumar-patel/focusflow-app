import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/tasks/actions", () => ({
  recordSessionAction: vi.fn().mockResolvedValue({ ok: true }),
}));

import { recordSessionAction } from "@/app/(app)/tasks/actions";

import { PomodoroTimer } from "./PomodoroTimer";

// Tiny durations (seconds, not minutes) — a unit-test-only shortcut,
// distinct from the app's real QA-override mechanism (T14 uses that;
// this just keeps the fake-timer test fast and deterministic).
const durationsSeconds = { work: 2, short_break: 1, long_break: 1 };

describe("PomodoroTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("runs work -> short break -> work automatically and calls the record-session action only after work intervals", async () => {
    render(<PomodoroTimer taskId="task-1" durationsSeconds={durationsSeconds} />);

    fireEvent.click(screen.getByRole("button", { name: /start focus session/i }));
    expect(screen.queryByText(/Focus:/)).not.toBeNull();

    // Work interval 1 completes (2s) -> short break, one session recorded.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.queryByText(/Short break:/)).not.toBeNull();
    expect(recordSessionAction).toHaveBeenCalledTimes(1);

    // Short break completes (1s) -> work, no additional call.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.queryByText(/Focus:/)).not.toBeNull();
    expect(recordSessionAction).toHaveBeenCalledTimes(1);

    // Work interval 2 completes -> short break, second call.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.queryByText(/Short break:/)).not.toBeNull();
    expect(recordSessionAction).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    // Work interval 3 completes -> short break, third call.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.queryByText(/Short break:/)).not.toBeNull();
    expect(recordSessionAction).toHaveBeenCalledTimes(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    // Work interval 4 completes -> LONG break (every 4th), fourth call.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.queryByText(/Long break:/)).not.toBeNull();
    expect(recordSessionAction).toHaveBeenCalledTimes(4);

    // Long break completes -> back to work, no additional call.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.queryByText(/Focus:/)).not.toBeNull();
    expect(recordSessionAction).toHaveBeenCalledTimes(4);
  });

  it("stopping a work interval early records nothing", async () => {
    render(<PomodoroTimer taskId="task-1" durationsSeconds={durationsSeconds} />);

    fireEvent.click(screen.getByRole("button", { name: /start focus session/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000); // halfway through the 2s work interval
    });
    fireEvent.click(screen.getByRole("button", { name: /stop/i }));

    expect(recordSessionAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /start focus session/i })).not.toBeNull();
  });
});
