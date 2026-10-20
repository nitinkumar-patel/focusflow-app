import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch, safeErrorMessage } from "./api-client";

// safeErrorMessage's whole job is to hide some apiFetch failure strings
// from end users and not others — a table test pinning exactly which
// (round-4 REVIEW finding: the safe/unsafe split shipped with zero
// coverage, and an earlier version's status-based heuristic
// misclassified "server misconfigured" as safe to show).
describe("safeErrorMessage", () => {
  it("hides apps/api's raw detail behind a generic message", () => {
    expect(safeErrorMessage({ error: "unauthorized", safe: false })).toBe(
      "Something went wrong. Try again.",
    );
    expect(safeErrorMessage({ error: "database unreachable", safe: false })).toBe(
      "Something went wrong. Try again.",
    );
  });

  it("hides the server-misconfigured string, even though it carries no HTTP status", () => {
    expect(safeErrorMessage({ error: "server misconfigured", safe: false })).toBe(
      "Something went wrong. Try again.",
    );
  });

  it("shows a network failure verbatim", () => {
    expect(
      safeErrorMessage({ error: "couldn't reach the server, try again", safe: true }),
    ).toBe("couldn't reach the server, try again");
  });

  it("shows a caller-constructed message verbatim when explicitly marked safe", () => {
    expect(safeErrorMessage({ error: "You must be logged in.", safe: true })).toBe(
      "You must be logged in.",
    );
  });
});

// apiFetch is what actually *decides* `safe` at each failure site —
// safeErrorMessage only dispatches on it. Every round-3/4/5 REVIEW
// regression was a misclassification here, not in the dispatcher, so
// the dispatcher tests above can't catch a flipped `safe` value on any
// of these branches (round-6 REVIEW finding: flip any `safe: true` in
// apiFetch to `false` or vice versa and the old suite still passed).
describe("apiFetch", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubEnv("API_BASE_URL", "http://api:8000");
    vi.stubEnv("INTERNAL_API_SECRET", "test-secret");
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns safe:false and does not include status when required env vars are unset", async () => {
    vi.stubEnv("API_BASE_URL", "");
    const result = await apiFetch("/tasks");
    expect(result).toEqual({ ok: false, error: "server misconfigured", safe: false });
  });

  it("returns safe:true when the network call itself fails", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("connection refused"));
    const result = await apiFetch("/tasks");
    expect(result).toEqual({
      ok: false,
      error: "couldn't reach the server, try again",
      safe: true,
    });
  });

  it("returns safe:false with apps/api's raw detail on a non-2xx JSON response", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const result = await apiFetch("/tasks");
    expect(result).toEqual({ ok: false, error: "unauthorized", status: 401, safe: false });
  });

  it("returns safe:false with a generic detail on a non-2xx non-JSON response", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("not json", { status: 500 }));
    const result = await apiFetch("/tasks");
    expect(result).toEqual({ ok: false, error: "request failed", status: 500, safe: false });
  });

  it("returns the parsed body on a 2xx response", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const result = await apiFetch<{ id: string }>("/tasks");
    expect(result).toEqual({ ok: true, data: { id: "1" } });
  });

  it("returns ok with no data on a 204 response instead of a parse failure", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const result = await apiFetch<undefined>("/timer/stop", { method: "POST" });
    expect(result).toEqual({ ok: true, data: undefined });
  });

  it("treats a stalled apps/api as unreachable once the timeout fires, not a hang", async () => {
    // Asserting only `init.signal instanceof AbortSignal` (the
    // original version of this test) passes just as well if the
    // timeout were changed to undici's 300s default — it can't catch a
    // regression of the behavior the fix exists for (round-7 REVIEW
    // nit). A round-7 fix drove the real ~5s timeout instead, which
    // worked but made this one test ~90% of the suite's wall-clock
    // time; mocking AbortSignal.timeout() itself gets the same
    // regression coverage — including pinning the exact configured
    // duration — without the wait (round-8 REVIEW nit).
    let recordedMs: number | undefined;
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      recordedMs = ms;
      return AbortSignal.abort(new DOMException("The operation was aborted.", "AbortError"));
    });
    global.fetch = vi.fn().mockImplementation((_url, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        // A signal from AbortSignal.abort() is already in the aborted
        // state at creation — its one 'abort' event already fired, so
        // a listener attached afterward (the normal case below) never
        // sees it. Real fetch() implementations check `.aborted`
        // synchronously up front for exactly this reason.
        if (init.signal?.aborted) {
          reject(init.signal.reason);
          return;
        }
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });

    const result = await apiFetch("/tasks");

    expect(result).toEqual({
      ok: false,
      error: "couldn't reach the server, try again",
      safe: true,
    });
    expect(recordedMs).toBe(5000);
  });

  it("returns safe:false with a generic detail when a 2xx response body isn't valid JSON", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));
    const result = await apiFetch("/tasks");
    expect(result).toEqual({ ok: false, error: "request failed", status: 200, safe: false });
  });

  it("never logs a submitted password on any failure branch", async () => {
    // AC11's web-half CI check (`verify-invariants`) greps for a
    // literal `console.*(...password...)` call — it can't see through
    // logFailure's indirection, so this pins the same invariant at the
    // one place a future logFailure call site could reintroduce it
    // (round-7 REVIEW nit). Covers all four branches that call
    // logFailure (round-8 REVIEW nit: the original version only drove
    // two of them).
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const marker = "shrtmk-password-marker";
    const opts = { method: "POST" as const, body: { password: marker } };

    global.fetch = vi.fn().mockRejectedValue(new Error("connection refused"));
    await apiFetch("/auth/register", opts);

    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "invalid" }), { status: 401 }),
    );
    await apiFetch("/auth/register", opts);

    global.fetch = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));
    await apiFetch("/auth/register", opts);

    vi.stubEnv("API_BASE_URL", "");
    await apiFetch("/auth/register", opts);
    vi.stubEnv("API_BASE_URL", "http://api:8000");

    for (const call of [...errorSpy.mock.calls, ...warnSpy.mock.calls]) {
      expect(JSON.stringify(call)).not.toContain(marker);
    }
  });

  // Pins the warn/error split itself (round-9 REVIEW nit: reverting the
  // 401-on-non-/auth/-path carve-out back to the blanket "4xx is routine"
  // rule left every existing test passing — nothing asserted on call
  // counts by level, so the carve-out had no test that could fail).
  // round-16 REVIEW fix: the carve-out is now detail-based, not
  // path-based (a desynced X-Internal-Secret locks out /auth/register
  // and /auth/login first, both under /auth/, so a path-based carve-out
  // missed the case it exists for) — asserts the "invalid internal
  // secret" detail logs at error regardless of path, and any other 401
  // detail stays routine regardless of path too.
  // round-17 REVIEW fix: this only ever asserted the routine case on an
  // /auth/ path (/auth/verify), which the *old* path-based rule also
  // routed to warn — the half of the change that actually altered
  // behavior (a routine 401 on /tasks, previously error, now warn) had
  // no assertion; a third case below covers it.
  it("logs a 401 with detail 'invalid internal secret' at error on any path, and any other 401 detail at warn", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "invalid internal secret" }), { status: 401 }),
    );
    await apiFetch("/tasks");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();

    errorSpy.mockClear();
    warnSpy.mockClear();

    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "invalid internal secret" }), { status: 401 }),
    );
    await apiFetch("/auth/register");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();

    errorSpy.mockClear();
    warnSpy.mockClear();

    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "invalid credentials" }), { status: 401 }),
    );
    await apiFetch("/auth/verify");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockClear();
    warnSpy.mockClear();

    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "unauthorized" }), { status: 401 }),
    );
    await apiFetch("/tasks");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
