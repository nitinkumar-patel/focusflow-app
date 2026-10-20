"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { getTimerAction, stopTimerAction, type Timer } from "@/app/(app)/focus/actions";

const PHASE_LABEL = { work: "Focus", short_break: "Short break", long_break: "Long break" } as const;

const RADIUS = 90;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const MIN_REFETCH_GAP_MS = 1000;

interface Props {
  initialTimer: Timer | null;
  taskTitle: string | null;
}

// Local clock model (spec "State & control flow"): remaining time is the
// server-supplied remaining at `server_time`, minus the client time that
// has elapsed since the timer was received. That makes the display
// independent of the client clock's offset from the server's.
export function FocusTimer({ initialTimer, taskTitle }: Props) {
  const [timer, setTimer] = useState<Timer | null>(initialTimer);
  // Client time at which `timer` arrived. `now` starts equal to it, so the
  // first render shows exactly the server's remaining time on both server
  // and client (no hydration mismatch); the tick moves it forward.
  const [receivedAt, setReceivedAt] = useState<number>(() => Date.now());
  const [now, setNow] = useState<number>(receivedAt);
  const [announcement, setAnnouncement] = useState("");
  const [error, setError] = useState("");
  const [stopping, setStopping] = useState(false);
  const inFlight = useRef(false);
  const lastFetchAt = useRef(0);
  const phaseRef = useRef<string | null>(initialTimer?.phase ?? null);

  const apply = useCallback((next: Timer | null) => {
    const t = Date.now();
    setTimer(next);
    setReceivedAt(t);
    setNow(t);
    const nextPhase = next?.phase ?? null;
    if (nextPhase !== phaseRef.current) {
      setAnnouncement(next ? `${PHASE_LABEL[next.phase]} started` : "Timer finished");
      phaseRef.current = nextPhase;
    }
  }, []);

  const refetch = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    lastFetchAt.current = Date.now();
    try {
      const result = await getTimerAction();
      if (result.ok) {
        setError("");
        apply(result.data);
      } else {
        setError("Could not refresh the timer. Retrying.");
      }
    } finally {
      inFlight.current = false;
    }
  }, [apply]);

  // One tick per second while a timer is shown.
  useEffect(() => {
    if (!timer) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timer]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "hidden") void refetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refetch]);

  const remainingMs =
    timer === null
      ? 0
      : Date.parse(timer.ends_at) -
        Date.parse(timer.server_time) -
        Math.max(0, now - receivedAt);

  // At zero, ask the server for the next phase. If it is not yet past the
  // boundary (small skew) the gap guard retries on later ticks.
  useEffect(() => {
    if (timer && remainingMs <= 0 && Date.now() - lastFetchAt.current >= MIN_REFETCH_GAP_MS) {
      void refetch();
    }
  }, [timer, now, remainingMs, refetch]);

  async function onStop() {
    setStopping(true);
    setError("");
    const result = await stopTimerAction();
    setStopping(false);
    if (result.ok) {
      apply(null);
      setAnnouncement("");
    } else {
      setError(result.error);
    }
  }

  const liveRegion = (
    <div aria-live="polite" className="sr-only">
      {announcement}
    </div>
  );

  if (!timer) {
    return (
      <div className="flex flex-col items-center gap-4">
        {liveRegion}
        <p className="w-full rounded-lg border border-dashed border-border bg-surface px-4 py-8 text-center text-muted-foreground">
          No timer is running. Pick a task and start a focus session from{" "}
          <Link
            href="/tasks"
            className="rounded-sm font-medium text-primary underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Tasks
          </Link>
          .
        </p>
      </div>
    );
  }

  const duration = timer.duration_seconds;
  const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const fraction = Math.min(1, Math.max(0, 1 - remainingMs / (duration * 1000)));
  const dashOffset = CIRCUMFERENCE * (1 - fraction);
  const mm = String(Math.floor(remainingSeconds / 60)).padStart(2, "0");
  const ss = String(remainingSeconds % 60).padStart(2, "0");
  const isWork = timer.phase === "work";

  return (
    <div className="flex flex-col items-center gap-6 rounded-xl border border-border bg-surface px-6 py-10 shadow-sm">
      {liveRegion}
      <div className="relative h-64 w-64">
        <svg viewBox="0 0 200 200" aria-hidden="true" className="h-full w-full -rotate-90" fill="none" strokeWidth="10">
          <circle cx="100" cy="100" r={RADIUS} className="stroke-border" />
          <circle
            data-testid="focus-ring-progress"
            cx="100"
            cy="100"
            r={RADIUS}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            className={isWork ? "stroke-primary" : "stroke-break"}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-5xl font-semibold tabular-nums text-foreground">{`${mm}:${ss}`}</span>
          <span className={`text-sm font-medium ${isWork ? "text-primary" : "text-break"}`}>{PHASE_LABEL[timer.phase]}</span>
        </div>
      </div>
      {taskTitle ? <p className="max-w-full break-words text-center text-lg font-medium text-foreground">{taskTitle}</p> : null}
      <p className="text-sm text-muted-foreground">{`Pomodoro ${timer.cycle_position} of 4`}</p>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <button
        type="button"
        onClick={onStop}
        disabled={stopping}
        className="rounded-md bg-primary px-6 py-2 font-medium text-background hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isWork ? "Stop" : "Skip break"}
      </button>
    </div>
  );
}
