import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { THEME_STORAGE_KEY } from "@/lib/theme";

import { ThemeProvider } from "./ThemeProvider";
import { ThemeToggle } from "./ThemeToggle";

beforeEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

function setup() {
  render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
  return screen.getByRole("button", { name: /theme/i });
}

describe("ThemeToggle", () => {
  it("toggles the dark class, persists, and reflects aria-pressed", () => {
    const button = setup();
    expect(button.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(button);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(button.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(button);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("reflects a pre-seeded dark preference immediately on mount", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const button = setup();
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
