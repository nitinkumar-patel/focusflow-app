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

import { createTaskAction, recordSessionAction } from "./actions";

const SESSION = { user: { id: "11111111-1111-4111-8111-111111111111" } };
const VALID_TASK_ID = "22222222-2222-4222-8222-222222222222";

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

describe("recordSessionAction", () => {
  beforeEach(() => {
    vi.mocked(auth).mockResolvedValue(SESSION as never);
    vi.mocked(apiFetch).mockReset();
  });

  const now = new Date().toISOString();

  it("rejects a non-UUID taskId without calling apiFetch", async () => {
    const result = await recordSessionAction("not-a-uuid", now, now, 100);
    expect(result.ok).toBe(false);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("rejects an unparseable startedAt without calling apiFetch", async () => {
    const result = await recordSessionAction(VALID_TASK_ID, "not-a-date", now, 100);
    expect(result.ok).toBe(false);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("rejects durationSeconds <= 0 without calling apiFetch", async () => {
    const result = await recordSessionAction(VALID_TASK_ID, now, now, 0);
    expect(result.ok).toBe(false);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("rejects durationSeconds above the 1500s AC5 ceiling without calling apiFetch", async () => {
    const result = await recordSessionAction(VALID_TASK_ID, now, now, 1501);
    expect(result.ok).toBe(false);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("rejects a non-integer durationSeconds without calling apiFetch", async () => {
    const result = await recordSessionAction(VALID_TASK_ID, now, now, 100.5);
    expect(result.ok).toBe(false);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("forwards valid input and the session's userId to apiFetch", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      data: { id: "1", task_id: VALID_TASK_ID, started_at: now, ended_at: now, duration_seconds: 100 },
    });
    const result = await recordSessionAction(VALID_TASK_ID, now, now, 100);
    expect(result.ok).toBe(true);
    expect(apiFetch).toHaveBeenCalledWith(`/tasks/${VALID_TASK_ID}/sessions`, {
      method: "POST",
      userId: SESSION.user.id,
      body: { started_at: now, ended_at: now, duration_seconds: 100 },
    });
  });

  it("rejects without calling apiFetch when there's no session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const result = await recordSessionAction(VALID_TASK_ID, now, now, 100);
    expect(result.ok).toBe(false);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
