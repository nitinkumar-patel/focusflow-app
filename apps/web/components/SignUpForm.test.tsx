import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(auth)/signup/actions", () => ({
  signUpAction: vi.fn(async () => ({ error: "Mocked failure" })),
}));

import { SignUpForm } from "./SignUpForm";

afterEach(cleanup);

describe("SignUpForm", () => {
  it("exposes labelled email and password inputs with their attributes", () => {
    render(<SignUpForm />);
    const email = screen.getByLabelText("Email") as HTMLInputElement;
    expect(email.name).toBe("email");
    expect(email.type).toBe("email");
    expect(email.required).toBe(true);
    expect(email.autocomplete).toBe("email");

    const password = screen.getByLabelText("Password") as HTMLInputElement;
    expect(password.name).toBe("password");
    expect(password.type).toBe("password");
    expect(password.required).toBe(true);
    expect(password.autocomplete).toBe("new-password");
  });

  it("renders the action error inside a role=alert element", async () => {
    render(<SignUpForm />);
    expect(screen.queryByRole("alert")).toBeNull();
    // jsdom enforces required/minLength on submit, so fill valid values first.
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-horse-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Mocked failure");
  });
});
