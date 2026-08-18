import { beforeEach, describe, expect, it, vi } from "vitest";

// Same rationale as tasks/actions.test.ts: signUpAction's re-validation
// (email shape, 8-128 password bound) had no automated test.

vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return { ...actual, apiFetch: vi.fn() };
});
vi.mock("@/lib/auth", () => ({
  signIn: vi.fn(),
}));
// signup/actions.ts imports AuthError directly from "next-auth" (not
// via @/lib/auth), and that module's own import chain pulls in
// next/server, which isn't resolvable outside the Next.js runtime —
// unrelated to anything under test here, so stub the one export used.
vi.mock("next-auth", () => ({
  AuthError: class AuthError extends Error {},
}));

import { apiFetch } from "@/lib/api-client";

import { signUpAction } from "./actions";

function formData(email: string, password: string): FormData {
  const fd = new FormData();
  fd.set("email", email);
  fd.set("password", password);
  return fd;
}

describe("signUpAction", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("rejects a malformed email without calling apiFetch", async () => {
    const result = await signUpAction({}, formData("not-an-email", "a-fine-password"));
    expect(result.error).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("rejects a password under 8 characters without calling apiFetch", async () => {
    const result = await signUpAction({}, formData("a@example.com", "short"));
    expect(result.error).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("rejects a password over 128 characters without calling apiFetch", async () => {
    const result = await signUpAction({}, formData("a@example.com", "x".repeat(129)));
    expect(result.error).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("forwards valid email/password to apiFetch", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: false,
      error: "email already registered",
      status: 409,
      safe: false,
    });
    const result = await signUpAction({}, formData("a@example.com", "a-fine-password"));
    expect(apiFetch).toHaveBeenCalledWith(
      "/auth/register",
      expect.objectContaining({ body: { email: "a@example.com", password: "a-fine-password" } }),
    );
    expect(result.error).toBe("That email is already registered.");
  });
});
