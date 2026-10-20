import { beforeEach, describe, expect, it, vi } from "vitest";

// Server Action re-validation (spec Boundaries § Always do) has been
// the site of three separate REVIEW-round fixes (rounds 1, 2, 5) and,
// until now, its only evidence was a dated manual curl transcript in
// qa-log.md that no gate re-runs (round-6 REVIEW finding). These tests
// pin the reject paths so a regression here fails a gate, not just a
// future manual pass.

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return { ...actual, apiFetch: vi.fn() };
});
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { apiFetch } from "@/lib/api-client";
import { auth } from "@/lib/auth";

import { createTaskAction } from "./actions";

const SESSION = { user: { id: "11111111-1111-4111-8111-111111111111" } };

function formDataWithTitle(title: string): FormData {
  const fd = new FormData();
  fd.set("title", title);
  return fd;
}

describe("createTaskAction", () => {
  beforeEach(() => {
    vi.mocked(auth).mockResolvedValue(SESSION as never);
    vi.mocked(apiFetch).mockReset();
  });

  it("rejects an empty title without calling apiFetch", async () => {
    const result = await createTaskAction({}, formDataWithTitle("   "));
    expect(result.error).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("rejects a title over 200 characters without calling apiFetch", async () => {
    const result = await createTaskAction({}, formDataWithTitle("x".repeat(201)));
    expect(result.error).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("forwards a valid, trimmed title and the session's userId to apiFetch", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      data: { id: "1", title: "Write the spec", created_at: "now" },
    });
    await createTaskAction({}, formDataWithTitle("  Write the spec  "));
    expect(apiFetch).toHaveBeenCalledWith("/tasks", {
      method: "POST",
      userId: SESSION.user.id,
      body: { title: "Write the spec" },
    });
  });

  it("rejects without calling apiFetch when there's no session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const result = await createTaskAction({}, formDataWithTitle("Write the spec"));
    expect(result.error).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

function formDataWithFields(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("createTaskAction priority and estimate", () => {
  beforeEach(() => {
    vi.mocked(auth).mockResolvedValue(SESSION as never);
    vi.mocked(apiFetch).mockReset();
  });

  it("passes priority and estimated_pomodoros to the API", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      data: {
        id: "1",
        title: "T",
        created_at: "now",
        priority: "high",
        estimated_pomodoros: 4,
        completed_pomodoros: 0,
      },
    });
    const result = await createTaskAction(
      {},
      formDataWithFields({ title: "T", priority: "high", estimated_pomodoros: "4" }),
    );
    expect(result.error).toBeUndefined();
    expect(apiFetch).toHaveBeenCalledWith("/tasks", {
      method: "POST",
      userId: SESSION.user.id,
      body: { title: "T", priority: "high", estimated_pomodoros: 4 },
    });
  });

  it.each(["0", "21", "-1", "1.5", "abc", "", "1e1", " "])(
    "rejects estimate %j without calling apiFetch",
    async (estimate) => {
      const result = await createTaskAction(
        {},
        formDataWithFields({ title: "T", priority: "low", estimated_pomodoros: estimate }),
      );
      expect(result.error).toBeTruthy();
      expect(apiFetch).not.toHaveBeenCalled();
    },
  );

  it.each(["urgent", "HIGH", ""])("rejects priority %j without calling apiFetch", async (priority) => {
    const result = await createTaskAction(
      {},
      formDataWithFields({ title: "T", priority, estimated_pomodoros: "2" }),
    );
    expect(result.error).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
