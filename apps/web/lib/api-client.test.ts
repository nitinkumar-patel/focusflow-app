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

  it(
    "treats a stalled apps/api as unreachable once the timeout fires, not a hang",
    async () => {
      // Asserting only `init.signal instanceof AbortSignal` (an earlier
      // version of this test) passes just as well if the timeout were
      // changed to undici's 300s default — it can't catch a regression
      // of the behavior the fix exists for (round-7 REVIEW nit).
      // AbortSignal.timeout() uses a native timer vitest's fake timers
      // can't intercept, so this drives the real ~5s timeout rather
      // than simulating it — slow but the only faithful option.
      global.fetch = vi.fn().mockImplementation((_url, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
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
    },
    10_000,
  );

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
    // (round-7 REVIEW nit).
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const marker = "shrtmk-password-marker";

    global.fetch = vi.fn().mockRejectedValue(new Error("connection refused"));
    await apiFetch("/auth/register", { method: "POST", body: { password: marker } });

    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "invalid" }), { status: 401 }),
    );
    await apiFetch("/auth/register", { method: "POST", body: { password: marker } });

    for (const call of [...errorSpy.mock.calls, ...warnSpy.mock.calls]) {
      expect(JSON.stringify(call)).not.toContain(marker);
    }
  });
});
