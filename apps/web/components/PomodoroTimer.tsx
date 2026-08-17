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
  const [remainingSeconds, setRemainingSeconds] = useState(durationsSeconds.work);
  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (!running) {
      return;
    }

    const id = setInterval(() => {
      setRemainingSeconds((current) => {
        if (current > 1) {
          return current - 1;
        }

        // This interval just finished naturally.
        const finishedKind = kind;
        const finishedStartedAt = startedAt ?? new Date();
        const finishedDurationSeconds = durationsSeconds[finishedKind];

        if (finishedKind === "work") {
          const endedAt = new Date(
            finishedStartedAt.getTime() + finishedDurationSeconds * 1000,
          );
          // Fire-and-forget: the timer keeps ticking regardless of the
          // network round trip. AC6/AC7 — only a completed work
          // interval reaches here, never a break.
          void recordSessionAction(
            taskId,
            finishedStartedAt.toISOString(),
            endedAt.toISOString(),
            finishedDurationSeconds,
          );
        }

        const newCompletedWorkIntervals =
          finishedKind === "work" ? completedWorkIntervals + 1 : completedWorkIntervals;
        const next = nextInterval({
          kind: finishedKind,
          completedWorkIntervals: newCompletedWorkIntervals,
        });

        setCompletedWorkIntervals(newCompletedWorkIntervals);
        setKind(next.kind);
        setStartedAt(new Date());
        return durationsSeconds[next.kind];
      });
    }, 1000);

    return () => clearInterval(id);
  }, [running, kind, completedWorkIntervals, startedAt, durationsSeconds, taskId]);

  function handleStart() {
    setStartedAt(new Date());
    setRunning(true);
  }

  function handleStop() {
    // Clears the countdown without recording anything (AC6) — resets
    // to a fresh work interval regardless of what was running.
    setRunning(false);
    setKind("work");
    setRemainingSeconds(durationsSeconds.work);
    setStartedAt(null);
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
    </span>
  );
}
