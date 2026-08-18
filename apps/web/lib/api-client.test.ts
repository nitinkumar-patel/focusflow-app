import { describe, expect, it } from "vitest";

import { safeErrorMessage } from "./api-client";

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

  it("shows a caller-constructed message verbatim when safe is omitted", () => {
    expect(safeErrorMessage({ error: "You must be logged in." })).toBe(
      "You must be logged in.",
    );
  });
});
