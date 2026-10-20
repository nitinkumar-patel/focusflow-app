"use client";

import { useEffect, useState } from "react";

import { recordSessionAction } from "@/app/(app)/tasks/actions";
import { firstInterval, nextInterval, type IntervalKind } from "@/lib/pomodoro-cycle";
import type { DurationsSeconds } from "@/lib/pomodoro-durations";

const LABELS: Record<IntervalKind, string> = {
  work: "Focus",
  short_break: "Short break",
  long_break: "Long break",
};

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

interface PomodoroTimerProps {
  taskId: string;
  durationsSeconds: DurationsSeconds;
}

// Per-task contextual control (AC13) — not the /tasks screen's primary
// action, which stays "Add task".
export function PomodoroTimer({ taskId, durationsSeconds }: PomodoroTimerProps) {
  const [kind, setKind] = useState<IntervalKind>(() => firstInterval().kind);
  const [completedWorkIntervals, setCompletedWorkIntervals] = useState(0);
  const [running, setRunning] = useState(false);
  // Absolute deadline (not a tick count) — a background tab throttles
  // setInterval, but comparing against Date.now() on whatever tick does
  // fire still completes the interval at the right wall-clock time
  // instead of silently running for hours.
  const [deadline, setDeadline] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(durationsSeconds.work);
  const [recordError, setRecordError] = useState<string | null>(null);

  useEffect(() => {
    if (!running || deadline === null) {
      return;
    }

    const id = setInterval(() => {
      const secondsLeft = Math.ceil((deadline - Date.now()) / 1000);

      if (secondsLeft > 0) {
        setRemainingSeconds(secondsLeft);
        return;
      }

      // This interval just finished naturally.
      const finishedKind = kind;
      const finishedDurationSeconds = durationsSeconds[finishedKind];
      const finishedEndedAt = new Date(deadline);
      // Derived from the deadline, not a `startedAt ?? new Date()`
      // fallback — `startedAt` is always set alongside `deadline` (see
      // handleStart/the interval-transition branch below), so the
      // fallback was unreachable in practice, but it would have built
      // a payload apps/api is guaranteed to reject (ended - started
      // ≈ 0 while duration_seconds is the full interval) had it ever
      // fired (round-6 REVIEW finding).
      const finishedStartedAt = new Date(deadline - finishedDurationSeconds * 1000);

      if (finishedKind === "work") {
        // AC6/AC7 — only a completed work interval reaches here, never
        // a break. Awaited (not fire-and-forget) so a failure is
        // surfaced instead of silently dropping the session.
        recordSessionAction(
          taskId,
          finishedStartedAt.toISOString(),
          finishedEndedAt.toISOString(),
          finishedDurationSeconds,
        )
          .then((result) => {
            // recordSessionAction already filters an unsafe error down
            // to display-safe copy before returning — nothing to
            // filter here.
            if (!result.ok) {
              setRecordError(result.error ?? "Couldn't record this session.");
            }
          })
          .catch(() => setRecordError("Couldn't record this session."));
      }

      const newCompletedWorkIntervals =
        finishedKind === "work" ? completedWorkIntervals + 1 : completedWorkIntervals;
      const next = nextInterval({
        kind: finishedKind,
        completedWorkIntervals: newCompletedWorkIntervals,
      });
      const nextStartedAt = new Date();

      setCompletedWorkIntervals(newCompletedWorkIntervals);
      setKind(next.kind);
      setDeadline(nextStartedAt.getTime() + durationsSeconds[next.kind] * 1000);
      setRemainingSeconds(durationsSeconds[next.kind]);
    }, 1000);

    return () => clearInterval(id);
  }, [running, deadline, kind, completedWorkIntervals, durationsSeconds, taskId]);

  function handleStart() {
    const now = new Date();
    setRecordError(null);
    setDeadline(now.getTime() + durationsSeconds.work * 1000);
    setRemainingSeconds(durationsSeconds.work);
    setRunning(true);
  }

  function handleStop() {
    // Clears the countdown without recording anything (AC6) — resets
    // to a fresh work interval regardless of what was running.
    // round-16 REVIEW nit: completedWorkIntervals is deliberately left
    // untouched — stopping mid-cycle doesn't undo the work intervals
    // already completed and recorded, so restarting still counts toward
    // the 4th-interval long break (AC5) rather than resetting the cycle.
    setRunning(false);
    setKind("work");
    setRemainingSeconds(durationsSeconds.work);
    setDeadline(null);
  }

  return (
    <span
      data-running={running}
      className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 font-mono text-2xl font-semibold tabular-nums sm:text-3xl ${
        kind === "work"
          ? "border-primary text-primary"
          : "border-border bg-surface text-foreground"
      }`}
    >
      {LABELS[kind]}: {formatTime(remainingSeconds)}{" "}
      {running ? (
        <button
          type="button"
          onClick={handleStop}
          className="rounded-md border border-border bg-background px-4 py-2 font-sans text-base font-medium text-foreground hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Stop
        </button>
      ) : (
        <button
          type="button"
          onClick={handleStart}
          className="rounded-md bg-primary px-4 py-2 font-sans text-base font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Start focus session
        </button>
      )}
      {recordError ? <span role="alert" className="w-full font-sans text-sm font-normal text-danger"> {recordError}</span> : null}
    </span>
  );
}
