import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/focus/actions", () => ({
  getTimerAction: vi.fn(),
  stopTimerAction: vi.fn().mockResolvedValue({ ok: true }),
}));

import { getTimerAction, stopTimerAction, type Timer } from "@/app/(app)/focus/actions";

import { FocusTimer } from "./FocusTimer";

const NOW = new Date("2026-01-01T12:00:00.000Z").getTime();
const TASK = "11111111-1111-4111-8111-111111111111";

function timer(over: Partial<Timer> & { remaining?: number; serverNow?: number } = {}): Timer {
  const { remaining = 600, serverNow = NOW, ...rest } = over;
  const duration = rest.duration_seconds ?? 1500;
  return {
    task_id: TASK,
    phase: "work",
    started_at: new Date(serverNow - (duration - remaining) * 1000).toISOString(),
    ends_at: new Date(serverNow + remaining * 1000).toISOString(),
    duration_seconds: duration,
    remaining_seconds: remaining,
    server_time: new Date(serverNow).toISOString(),
    cycle_position: 1,
    ...rest,
  };
}

const C = 2 * Math.PI * 90;
const offset = () => Number(screen.getByTestId("focus-ring-progress").getAttribute("stroke-dashoffset"));

describe("FocusTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("shows the empty state with a Tasks link and no timer controls (AC31)", () => {
    render(<FocusTimer initialTimer={null} taskTitle={null} />);
    expect(screen.getByRole("link", { name: /tasks/i }).getAttribute("href")).toBe("/tasks");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("fills the ring by elapsed/duration, corrected for clock skew (AC32)", () => {
    // Server clock is 30s ahead of the client; 600 of 1500s remain by the server's clock.
    render(<FocusTimer initialTimer={timer({ remaining: 600, serverNow: NOW + 30_000 })} taskTitle="Write" />);
    expect(offset()).toBeCloseTo(C * (600 / 1500), 3);
    act(() => {
      vi.advanceTimersByTime(300_000);
    });
    expect(offset()).toBeCloseTo(C * (300 / 1500), 3);
  });

  it("shows mm:ss, phase name and task title (AC33)", () => {
    render(<FocusTimer initialTimer={timer({ remaining: 605 })} taskTitle="Write report" />);
    expect(screen.getByText("10:05")).toBeTruthy();
    expect(screen.getByText("Focus")).toBeTruthy();
    expect(screen.getByText("Write report")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText("10:00")).toBeTruthy();
  });

  it.each([
    ["short_break", "Short break"],
    ["long_break", "Long break"],
  ] as const)("names the %s phase (AC33)", (phase, name) => {
    render(<FocusTimer initialTimer={timer({ phase, duration_seconds: 300, remaining: 100 })} taskTitle="T" />);
    expect(screen.getByText(name)).toBeTruthy();
  });

  it.each([
    // [sessions c, work n, break n] — values as the API supplies them
    [0, 1, null],
    [1, 2, 1],
    [2, 3, 2],
    [3, 4, 3],
    [4, 1, 4],
    [5, 2, 1],
  ])("displays Pomodoro n of 4 from cycle_position for c=%i (AC34)", (_c, workN, breakN) => {
    render(<FocusTimer initialTimer={timer({ cycle_position: workN })} taskTitle="T" />);
    expect(screen.getByText(`Pomodoro ${workN} of 4`)).toBeTruthy();
    cleanup();
    if (breakN !== null) {
      render(<FocusTimer initialTimer={timer({ phase: "short_break", cycle_position: breakN })} taskTitle="T" />);
      expect(screen.getByText(`Pomodoro ${breakN} of 4`)).toBeTruthy();
    }
  });

  it("re-fetches at zero and shows the break without reload (AC35), announcing once (AC40)", async () => {
    vi.mocked(getTimerAction).mockResolvedValue({
      ok: true,
      data: timer({ phase: "short_break", duration_seconds: 300, remaining: 300, cycle_position: 1, serverNow: NOW + 3000 }),
    });
    render(<FocusTimer initialTimer={timer({ remaining: 3 })} taskTitle="Write" />);
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(getTimerAction).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Short break")).toBeTruthy();
    expect(screen.getByText("05:00")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skip break" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1); // AC37
    const live = document.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(live.textContent).toMatch(/short break/i);
    // Ticking on does not re-announce or change the region.
    const before = live.textContent;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(live.textContent).toBe(before);
    expect(document.querySelectorAll('[aria-live]')).toHaveLength(1);
  });

  it("shows the empty state when a break reaches zero (AC44, AC31)", async () => {
    vi.mocked(getTimerAction).mockResolvedValue({ ok: true, data: null });
    render(<FocusTimer initialTimer={timer({ phase: "short_break", duration_seconds: 300, remaining: 2 })} taskTitle="T" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByRole("link", { name: /tasks/i }).getAttribute("href")).toBe("/tasks");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("re-fetches when the tab becomes visible (AC36)", async () => {
    vi.mocked(getTimerAction).mockResolvedValue({ ok: true, data: timer({ remaining: 400 }) });
    render(<FocusTimer initialTimer={timer({ remaining: 600 })} taskTitle="T" />);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(getTimerAction).toHaveBeenCalledTimes(1);
    expect(screen.getByText("06:40")).toBeTruthy();
  });

  it("has one focusable, keyboard-activatable primary control that stops the timer (AC37, AC38)", async () => {
    render(<FocusTimer initialTimer={timer()} taskTitle="T" />);
    const stop = screen.getByRole("button", { name: "Stop" });
    expect(screen.getAllByRole("button")).toHaveLength(1);
    stop.focus();
    expect(document.activeElement).toBe(stop);
    expect(stop.getAttribute("tabindex")).not.toBe("-1");
    expect(stop.className).toMatch(/focus-visible:/);
    // A native <button> turns Enter/Space into click; assert the type and the click path.
    expect(stop.tagName).toBe("BUTTON");
    await act(async () => {
      fireEvent.click(stop);
    });
    expect(stopTimerAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: /tasks/i })).toBeTruthy();
  });

  it("skips a break through the same single control (AC37)", async () => {
    render(<FocusTimer initialTimer={timer({ phase: "long_break", duration_seconds: 900, remaining: 800 })} taskTitle="T" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Skip break" }));
    });
    expect(stopTimerAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("gives the per-second countdown no live-region or timer role (AC39)", () => {
    render(<FocusTimer initialTimer={timer({ remaining: 605 })} taskTitle="T" />);
    const countdown = screen.getByText("10:05");
    for (let el: HTMLElement | null = countdown; el; el = el.parentElement) {
      expect(el.getAttribute("aria-live")).toBeNull();
      expect(["timer", "status", "alert", "log"]).not.toContain(el.getAttribute("role"));
    }
    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
