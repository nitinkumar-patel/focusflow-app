import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(auth)/login/actions", () => ({
  loginAction: vi.fn(async () => ({ error: "Mocked failure" })),
}));

import { LoginForm } from "./LoginForm";

afterEach(cleanup);

describe("LoginForm", () => {
  it("exposes labelled email and password inputs with their attributes", () => {
    render(<LoginForm />);
    const email = screen.getByLabelText("Email") as HTMLInputElement;
    expect(email.name).toBe("email");
    expect(email.type).toBe("email");
    expect(email.required).toBe(true);
    expect(email.autocomplete).toBe("email");

    const password = screen.getByLabelText("Password") as HTMLInputElement;
    expect(password.name).toBe("password");
    expect(password.type).toBe("password");
    expect(password.required).toBe(true);
    expect(password.autocomplete).toBe("current-password");
  });

  it("renders the action error inside a role=alert element", async () => {
    render(<LoginForm />);
    expect(screen.queryByRole("alert")).toBeNull();
    // jsdom enforces required/minLength on submit, so fill valid values first.
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-horse-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Mocked failure");
  });
});
