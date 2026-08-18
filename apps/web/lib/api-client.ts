// The single wrapper every Server Action calls apps/api through — attaches
// X-Internal-Secret / X-User-Id, normalizes errors. Never includes the
// request body or headers (which may carry a password or the internal
// secret) in a thrown error or log line — spec AC11 (web half).

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number; safe: boolean };

interface ApiFetchOptions {
  method?: "GET" | "POST";
  body?: unknown;
  userId?: string;
}

export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<ApiResult<T>> {
  const apiBaseUrl = process.env.API_BASE_URL;
  const internalSecret = process.env.INTERNAL_API_SECRET;
  if (!apiBaseUrl || !internalSecret) {
    // Not safe to show verbatim — names what's broken in the deployment.
    return { ok: false, error: "server misconfigured", safe: false };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Internal-Secret": internalSecret,
  };
  if (options.userId) {
    headers["X-User-Id"] = options.userId;
  }

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
    });
  } catch {
    // Safe to show verbatim — static copy, names nothing about the
    // deployment beyond "the network call didn't complete".
    return { ok: false, error: "couldn't reach the server, try again", safe: true };
  }

  if (!response.ok) {
    let detail = "request failed";
    try {
      const body: unknown = await response.json();
      if (
        body !== null &&
        typeof body === "object" &&
        "detail" in body &&
        typeof body.detail === "string"
      ) {
        detail = body.detail;
      }
    } catch {
      // Body wasn't JSON — keep the generic message.
    }
    // Not safe — this is apps/api's raw `detail` (or the generic
    // fallback), never vetted for end-user display.
    return { ok: false, error: detail, status: response.status, safe: false };
  }

  const data = (await response.json()) as T;
  return { ok: true, data };
}

// A page or form rendering a failed result should not echo `error`
// unconditionally — some of apiFetch's own failure strings ("server
// misconfigured", apps/api's raw `detail`) aren't meant for an end
// user and could name what's broken in the deployment. `safe` is the
// explicit discriminant for that (round-4 REVIEW fix: an earlier
// version inferred safety from whether `status` was set, which
// misclassified "server misconfigured" — a safe-*looking* string with
// no status — as fine to show). Callers that construct their own
// `error` directly (not via apiFetch) — e.g. "You must be logged in."
// — omit `safe`, which defaults true: it's static copy they wrote for
// display, not upstream data.
export function safeErrorMessage(result: { error: string; safe?: boolean }): string {
  return result.safe === false ? "Something went wrong. Try again." : result.error;
}
