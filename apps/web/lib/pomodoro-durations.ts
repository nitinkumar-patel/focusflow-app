// Interval-duration resolution — pure, env-free (takes the raw env
// string as a parameter rather than reading process.env directly, so
// it's unit-testable without mocking the environment). Called only
// from app/(app)/tasks/page.tsx, the one Server Component that reads
// POMODORO_TEST_SHORT_INTERVALS. See plan.md's Design decisions.

export interface DurationsSeconds {
  work: number;
  short_break: number;
  long_break: number;
}

const DEFAULT_DURATIONS: DurationsSeconds = {
  work: 1500, // 25 minutes — AC5
  short_break: 300, // 5 minutes — AC5
  long_break: 900, // 15 minutes — AC5
};

// Fixed QA-override durations (round-3 plan revision) — deliberately
// short but non-trivial, so a manual E2E pass doesn't require a real
// 25-minute wait.
const OVERRIDE_DURATIONS: DurationsSeconds = {
  work: 60,
  short_break: 15,
  long_break: 30,
};

export function resolveDurations(overrideEnvValue: string | undefined): DurationsSeconds {
  return overrideEnvValue ? OVERRIDE_DURATIONS : DEFAULT_DURATIONS;
}
