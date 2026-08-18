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

  it("passes an AbortSignal so a stalled apps/api can't hang the request forever", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await apiFetch("/tasks");
    const callArgs = vi.mocked(global.fetch).mock.calls[0];
    const init = callArgs[1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
