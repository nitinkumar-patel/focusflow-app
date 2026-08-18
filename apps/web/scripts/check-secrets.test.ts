import { execFileSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

// AC19 claims *either app*, started with a required secret unset or
// empty, refuses to start. apps/api has an isolated unit test for its
// half (test_config.py); this is the same check for web's half, run
// as a real subprocess so it exercises the actual script Docker runs
// before `node server.js` — not just its logic in the abstract
// (round-6 REVIEW finding: the only prior evidence was a confounded
// whole-stack observation, since an empty POSTGRES_PASSWORD stops the
// db container before this script ever runs).
const SCRIPT_PATH = path.resolve(__dirname, "check-secrets.mjs");

function runWithEnv(overrides: Record<string, string>): { status: number; stderr: string } {
  // Start from a clean slate for the two secrets under test (never
  // inherit a real value from this process's own environment), but
  // keep the rest of process.env so `node` itself can still run (PATH,
  // etc).
  const env = { ...process.env, INTERNAL_API_SECRET: "", AUTH_SECRET: "", ...overrides };
  try {
    execFileSync("node", [SCRIPT_PATH], { env, stdio: "pipe" });
    return { status: 0, stderr: "" };
  } catch (error) {
    const e = error as { status: number; stderr: Buffer };
    return { status: e.status, stderr: e.stderr.toString() };
  }
}

describe("check-secrets.mjs", () => {
  it("exits non-zero when INTERNAL_API_SECRET is unset", () => {
    const result = runWithEnv({ AUTH_SECRET: "set" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("INTERNAL_API_SECRET");
  });

  it("exits non-zero when AUTH_SECRET is empty", () => {
    const result = runWithEnv({ INTERNAL_API_SECRET: "set", AUTH_SECRET: "" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("AUTH_SECRET");
  });

  it("exits zero when both secrets are set", () => {
    const result = runWithEnv({ INTERNAL_API_SECRET: "set", AUTH_SECRET: "set" });
    expect(result.status).toBe(0);
  });
});
