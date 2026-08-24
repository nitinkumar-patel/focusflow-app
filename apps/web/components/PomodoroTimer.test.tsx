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
    render(<PomodoroTimer taskId="11111111-1111-4111-8111-111111111111" durationsSeconds={durationsSeconds} />);

    const clickTime = Date.now(); // fake timers make this deterministic
    fireEvent.click(screen.getByRole("button", { name: /start focus session/i }));
    expect(screen.queryByText(/Focus:/)).not.toBeNull();

    // Work interval 1 completes (2s) -> short break, one session recorded.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.queryByText(/Short break:/)).not.toBeNull();
    expect(recordSessionAction).toHaveBeenCalledTimes(1);
    // Payload, not just call count (round-6 REVIEW finding): apps/api
    // rejects a session where duration_seconds doesn't match
    // ended_at - started_at (±2s) or where taskId isn't the task's
    // real id — a regression here would only surface at runtime as a
    // generic "Something went wrong" the user can't diagnose. Asserted
    // against the click time (not each other — round-7 REVIEW nit: both
    // values are derived from the same `deadline` in production, so
    // checking them against each other can't fail even if a reverted
    // `new Date()` fallback reintroduced the bug this pins).
    const [calledTaskId, calledStartedAt, calledEndedAt, calledDuration] = vi.mocked(
      recordSessionAction,
    ).mock.calls[0];
    expect(calledTaskId).toBe("11111111-1111-4111-8111-111111111111");
    expect(calledDuration).toBe(2);
    expect(Date.parse(calledStartedAt)).toBe(clickTime);
    expect(Date.parse(calledEndedAt)).toBe(clickTime + 2000);

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
    render(<PomodoroTimer taskId="11111111-1111-4111-8111-111111111111" durationsSeconds={durationsSeconds} />);

    fireEvent.click(screen.getByRole("button", { name: /start focus session/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000); // halfway through the 2s work interval
    });
    fireEvent.click(screen.getByRole("button", { name: /stop/i }));

    expect(recordSessionAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /start focus session/i })).not.toBeNull();
  });

  // round-17 REVIEW nit: handleStop's comment asserts completedWorkIntervals
  // is deliberately preserved across a stop (so a restart still counts
  // toward the 4th-interval long break), but nothing exercised that
  // invariant — `setCompletedWorkIntervals(0)` in handleStop would pass
  // every other test. This stops mid-cycle after one real completion,
  // restarts, and drives three more completions to the 4th, asserting the
  // long break (not a 4th short break) still lands there.
  it("preserves the completed-work-interval count across a mid-cycle stop and restart", async () => {
    render(<PomodoroTimer taskId="11111111-1111-4111-8111-111111111111" durationsSeconds={durationsSeconds} />);

    // Work interval 1 completes fully -> short break, count = 1. The cycle
    // auto-continues through breaks (no re-click needed) until stopped.
    fireEvent.click(screen.getByRole("button", { name: /start focus session/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.queryByText(/Short break:/)).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.queryByText(/Focus:/)).not.toBeNull();

    // Work interval 2 stopped halfway through — no completion, count stays 1.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    fireEvent.click(screen.getByRole("button", { name: /stop/i }));
    expect(recordSessionAction).toHaveBeenCalledTimes(1);

    // Restart (single click — the cycle auto-continues from here through
    // breaks, as above) and complete three more full work intervals (2, 3, 4).
    fireEvent.click(screen.getByRole("button", { name: /start focus session/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.queryByText(/Short break:/)).not.toBeNull();
    expect(recordSessionAction).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.queryByText(/Short break:/)).not.toBeNull();
    expect(recordSessionAction).toHaveBeenCalledTimes(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    // The 4th completed work interval — if the stop had silently reset
    // the count, this would be a short break, not long.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.queryByText(/Long break:/)).not.toBeNull();
    expect(recordSessionAction).toHaveBeenCalledTimes(4);
  });

  it("completes the interval on wall-clock time even if fewer ticks fired than seconds elapsed", async () => {
    // Simulates a throttled background tab: the browser skips most
    // setInterval callbacks, but real time has still passed. A
    // tick-counting timer would stay stuck near the full duration; a
    // deadline-based one notices the deadline is already past on
    // whatever tick does fire.
    render(<PomodoroTimer taskId="11111111-1111-4111-8111-111111111111" durationsSeconds={durationsSeconds} />);

    fireEvent.click(screen.getByRole("button", { name: /start focus session/i }));

    // Jump the clock 10s ahead (far past the 2s work interval) without
    // letting fake timers "catch up" via repeated callback firings —
    // then let exactly one 1s tick fire.
    vi.setSystemTime(Date.now() + 10_000);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(screen.queryByText(/Short break:/)).not.toBeNull();
    expect(recordSessionAction).toHaveBeenCalledTimes(1);
  });

  it("shows an inline error when recordSessionAction fails, without losing the interval transition", async () => {
    vi.mocked(recordSessionAction).mockResolvedValueOnce({
      ok: false,
      error: "duplicate session",
    });
    render(<PomodoroTimer taskId="11111111-1111-4111-8111-111111111111" durationsSeconds={durationsSeconds} />);

    fireEvent.click(screen.getByRole("button", { name: /start focus session/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // The timer still advances to the break even though recording
    // failed — a network error shouldn't freeze the UI (round-2 REVIEW
    // finding: this branch, added for round-1 Concern #7, had no test).
    expect(screen.queryByText(/Short break:/)).not.toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("duplicate session");
  });
});
