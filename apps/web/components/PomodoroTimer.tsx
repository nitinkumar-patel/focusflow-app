"use client";

import { useEffect, useState } from "react";

import { recordSessionAction } from "@/app/(app)/tasks/actions";
import { safeErrorMessage } from "@/lib/api-client";
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
  const [startedAt, setStartedAt] = useState<Date | null>(null);
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
      const finishedStartedAt = startedAt ?? new Date();
      const finishedDurationSeconds = durationsSeconds[finishedKind];
      const finishedEndedAt = new Date(deadline);

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
            if (!result.ok) {
              setRecordError(
                safeErrorMessage({
                  error: result.error ?? "Couldn't record this session.",
                  safe: result.safe,
                }),
              );
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
      setStartedAt(nextStartedAt);
      setDeadline(nextStartedAt.getTime() + durationsSeconds[next.kind] * 1000);
      setRemainingSeconds(durationsSeconds[next.kind]);
    }, 1000);

    return () => clearInterval(id);
  }, [running, deadline, kind, completedWorkIntervals, startedAt, durationsSeconds, taskId]);

  function handleStart() {
    const now = new Date();
    setRecordError(null);
    setStartedAt(now);
    setDeadline(now.getTime() + durationsSeconds.work * 1000);
    setRemainingSeconds(durationsSeconds.work);
    setRunning(true);
  }

  function handleStop() {
    // Clears the countdown without recording anything (AC6) — resets
    // to a fresh work interval regardless of what was running.
    setRunning(false);
    setKind("work");
    setRemainingSeconds(durationsSeconds.work);
    setStartedAt(null);
    setDeadline(null);
  }

  return (
    <span>
      {LABELS[kind]}: {formatTime(remainingSeconds)}{" "}
      {running ? (
        <button type="button" onClick={handleStop}>
          Stop
        </button>
      ) : (
        <button type="button" onClick={handleStart}>
          Start focus session
        </button>
      )}
      {recordError ? <span role="alert"> {recordError}</span> : null}
    </span>
  );
}
