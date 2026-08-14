import { describe, expect, it } from "vitest";
import { resolveDurations } from "./pomodoro-durations";

describe("resolveDurations", () => {
  it("with no override returns the AC5 defaults", () => {
    expect(resolveDurations(undefined)).toEqual({
      work: 1500,
      short_break: 300,
      long_break: 900,
    });
  });

  it("with a non-empty override returns the shortened QA durations", () => {
    expect(resolveDurations("1")).toEqual({
      work: 60,
      short_break: 15,
      long_break: 30,
    });
  });

  it("with an empty-string override returns the defaults", () => {
    expect(resolveDurations("")).toEqual({
      work: 1500,
      short_break: 300,
      long_break: 900,
    });
  });
});
