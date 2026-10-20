import { beforeEach } from "vitest";

// jsdom implements no window.matchMedia. Tests flip `matchMediaState.matches`
// to exercise both OS-preference branches.
export const matchMediaState = { matches: false };

Object.defineProperty(window, "matchMedia", {
  writable: true,
  configurable: true,
  value: (query: string) => ({
    get matches() {
      return matchMediaState.matches;
    },
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
});

beforeEach(() => {
  matchMediaState.matches = false;
});
