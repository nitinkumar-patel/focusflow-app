import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return { ...actual, apiFetch: vi.fn() };
});
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { apiFetch } from "@/lib/api-client";
import { auth } from "@/lib/auth";

import { getTimerAction, startTimerAction, stopTimerAction, type Timer } from "./actions";

const SESSION = { user: { id: "11111111-1111-4111-8111-111111111111" } };
const TASK_ID = "22222222-2222-4222-8222-222222222222";
const TIMER: Timer = {
  task_id: TASK_ID,
  phase: "work",
  started_at: "2026-01-01T00:00:00Z",
  ends_at: "2026-01-01T00:25:00Z",
  duration_seconds: 1500,
  remaining_seconds: 1500,
  server_time: "2026-01-01T00:00:00Z",
  cycle_position: 1,
};

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue(SESSION as never);
  vi.mocked(apiFetch).mockReset();
});

describe("startTimerAction", () => {
  it("POSTs /timer/start with the task id and the session's userId", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ok: true, data: TIMER });
    const result = await startTimerAction(TASK_ID);
    expect(result).toEqual({ ok: true, timer: TIMER });
    expect(apiFetch).toHaveBeenCalledWith("/timer/start", {
      method: "POST",
      userId: SESSION.user.id,
      body: { task_id: TASK_ID },
    });
  });

  it("rejects a non-UUID task id without calling apiFetch", async () => {
    const result = await startTimerAction("not-a-uuid");
    expect(result.ok).toBe(false);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("rejects without calling apiFetch when there's no session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const result = await startTimerAction(TASK_ID);
    expect(result.ok).toBe(false);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("maps 409 and 404 to fixed messages, never the raw detail", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: false,
      error: "raw conflict detail",
      status: 409,
      safe: false,
    });
    const conflict = await startTimerAction(TASK_ID);
    expect(conflict).toEqual({ ok: false, error: "A timer is already running." });

    vi.mocked(apiFetch).mockResolvedValue({
      ok: false,
      error: "raw missing detail",
      status: 404,
      safe: false,
    });
    const missing = await startTimerAction(TASK_ID);
    expect(missing).toEqual({ ok: false, error: "Task not found." });
  });

  it("hides other unsafe failures behind the generic message", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: false,
      error: "database unreachable",
      status: 500,
      safe: false,
    });
    const result = await startTimerAction(TASK_ID);
    expect(result).toEqual({ ok: false, error: "Something went wrong. Try again." });
  });
});

describe("getTimerAction", () => {
  it("GETs /timer with the session's userId", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ok: true, data: TIMER });
    const result = await getTimerAction();
    expect(result).toEqual({ ok: true, data: TIMER });
    expect(apiFetch).toHaveBeenCalledWith("/timer", { userId: SESSION.user.id });
  });

  it("passes a null timer through as ok", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ok: true, data: null });
    const result = await getTimerAction();
    expect(result).toEqual({ ok: true, data: null });
  });

  it("rejects without calling apiFetch when there's no session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const result = await getTimerAction();
    expect(result.ok).toBe(false);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe("stopTimerAction", () => {
  it("POSTs /timer/stop with the session's userId", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ok: true, data: undefined });
    const result = await stopTimerAction();
    expect(result).toEqual({ ok: true });
    expect(apiFetch).toHaveBeenCalledWith("/timer/stop", {
      method: "POST",
      userId: SESSION.user.id,
    });
  });

  it("maps 404 (no timer) to a fixed message", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: false,
      error: "raw",
      status: 404,
      safe: false,
    });
    const result = await stopTimerAction();
    expect(result).toEqual({ ok: false, error: "No timer is running." });
  });

  it("rejects without calling apiFetch when there's no session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const result = await stopTimerAction();
    expect(result.ok).toBe(false);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
