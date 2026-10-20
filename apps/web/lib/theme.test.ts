import { beforeEach, describe, expect, it, vi } from "vitest";

import { matchMediaState } from "../vitest.setup";
import { applyTheme, resolveInitialTheme, THEME_STORAGE_KEY } from "./theme";

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  matchMediaState.matches = false;
});

describe("resolveInitialTheme", () => {
  it("returns the stored dark value", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(resolveInitialTheme()).toBe("dark");
  });

  it("returns the stored light value even when the OS prefers dark", () => {
    matchMediaState.matches = true;
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    expect(resolveInitialTheme()).toBe("light");
  });

  describe.each([
    ["nothing stored", () => {}],
    ["malformed Dark", () => localStorage.setItem(THEME_STORAGE_KEY, "Dark")],
    ["unrecognized blue", () => localStorage.setItem(THEME_STORAGE_KEY, "blue")],
    [
      "storage access throws",
      () =>
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
          throw new Error("denied");
        }),
    ],
  ])("falls back to matchMedia when %s", (_name, setup) => {
    it("dark when matches is true", () => {
      setup();
      matchMediaState.matches = true;
      expect(resolveInitialTheme()).toBe("dark");
    });
    it("light when matches is false", () => {
      setup();
      matchMediaState.matches = false;
      expect(resolveInitialTheme()).toBe("light");
    });
  });
});

describe("applyTheme", () => {
  it("dark adds the class and persists", () => {
    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("focusflow-theme")).toBe("dark");
  });

  it("light removes the class and persists", () => {
    document.documentElement.classList.add("dark");
    applyTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("focusflow-theme")).toBe("light");
  });

  it("still toggles the class when storage write throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => applyTheme("dark")).not.toThrow();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
