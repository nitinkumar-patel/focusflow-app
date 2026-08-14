// Pure Pomodoro cycle state machine — kind sequencing only. Interval
// *durations* are resolved separately (pomodoro-durations.ts) and
// looked up by the caller; this file stays fully env-free so it's
// trivially unit-testable. See plan.md's Design (LLD) § State & control
// flow / Design decisions for why this needs the (kind, count) shape
// rather than a count-only signature.

export type IntervalKind = "work" | "short_break" | "long_break";

export interface Interval {
  kind: IntervalKind;
}

const LONG_BREAK_EVERY = 4;

export function firstInterval(): Interval {
  return { kind: "work" };
}

export function nextInterval(justCompleted: {
  kind: IntervalKind;
  completedWorkIntervals: number;
}): Interval {
  if (justCompleted.kind === "work") {
    if (justCompleted.completedWorkIntervals < 1) {
      throw new Error(
        "nextInterval: completedWorkIntervals must be >= 1 when the just-completed kind is 'work'",
      );
    }
    return justCompleted.completedWorkIntervals % LONG_BREAK_EVERY === 0
      ? { kind: "long_break" }
      : { kind: "short_break" };
  }
  return { kind: "work" };
}
