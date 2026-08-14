import { describe, expect, it } from "vitest";
import { firstInterval, nextInterval } from "./pomodoro-cycle";

describe("firstInterval", () => {
  it("returns a work interval", () => {
    expect(firstInterval()).toEqual({ kind: "work" });
  });
});

describe("nextInterval", () => {
  it("after 1 completed work interval returns a short break", () => {
    expect(nextInterval({ kind: "work", completedWorkIntervals: 1 })).toEqual({
      kind: "short_break",
    });
  });

  it("after a short break returns a work interval", () => {
    expect(nextInterval({ kind: "short_break", completedWorkIntervals: 1 })).toEqual({
      kind: "work",
    });
  });

  it("after 4 completed work intervals returns a long break", () => {
    expect(nextInterval({ kind: "work", completedWorkIntervals: 4 })).toEqual({
      kind: "long_break",
    });
  });

  it("after a long break returns a work interval", () => {
    expect(nextInterval({ kind: "long_break", completedWorkIntervals: 4 })).toEqual({
      kind: "work",
    });
  });

  it("after 8 completed work intervals also returns a long break", () => {
    expect(nextInterval({ kind: "work", completedWorkIntervals: 8 })).toEqual({
      kind: "long_break",
    });
  });

  it("throws when kind is work and completedWorkIntervals is 0", () => {
    expect(() => nextInterval({ kind: "work", completedWorkIntervals: 0 })).toThrow();
  });
});
