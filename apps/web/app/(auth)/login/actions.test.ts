import { beforeEach, describe, expect, it, vi } from "vitest";

// round-16 REVIEW Blocker: AC2's login half had zero test coverage —
// loginAction's AuthError branch, its redirectTo, and the non-AuthError
// rethrow were all exercised by nothing. Mirrors signup/actions.test.ts.

vi.mock("@/lib/auth", () => ({
  signIn: vi.fn(),
}));
// login/actions.ts imports AuthError directly from "next-auth" (not via
// @/lib/auth), and that module's own import chain pulls in next/server,
// which isn't resolvable outside the Next.js runtime — unrelated to
// anything under test here, so stub the one export used.
vi.mock("next-auth", () => ({
  AuthError: class AuthError extends Error {},
}));

import { AuthError } from "next-auth";

import { signIn } from "@/lib/auth";

import { loginAction } from "./actions";

function formData(email: string, password: string): FormData {
  const fd = new FormData();
  fd.set("email", email);
  fd.set("password", password);
  return fd;
}

describe("loginAction", () => {
  beforeEach(() => {
    vi.mocked(signIn).mockReset();
  });

  it("rejects missing fields without calling signIn", async () => {
    const result = await loginAction({}, formData("", ""));
    expect(result.error).toBeTruthy();
    expect(signIn).not.toHaveBeenCalled();
  });

  it("forwards email/password and redirectTo to signIn", async () => {
    vi.mocked(signIn).mockResolvedValue(undefined);
    await loginAction({}, formData("a@example.com", "a-fine-password"));
    expect(signIn).toHaveBeenCalledWith("credentials", {
      email: "a@example.com",
      password: "a-fine-password",
      redirectTo: "/tasks",
    });
  });

  it("maps an AuthError from signIn to a generic inline error", async () => {
    vi.mocked(signIn).mockRejectedValue(new AuthError("CredentialsSignin"));
    const result = await loginAction({}, formData("a@example.com", "wrong-password"));
    expect(result.error).toBe("Incorrect email or password.");
  });

  it("rethrows a non-AuthError instead of swallowing it as a login failure", async () => {
    vi.mocked(signIn).mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(loginAction({}, formData("a@example.com", "a-fine-password"))).rejects.toThrow(
      "NEXT_REDIRECT",
    );
  });
});
