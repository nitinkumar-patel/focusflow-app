// The single wrapper every Server Action calls apps/api through — attaches
// X-Internal-Secret / X-User-Id, normalizes errors. Never includes the
// request body or headers (which may carry a password or the internal
// secret) in a thrown error or log line — spec AC11 (web half).

const FETCH_TIMEOUT_MS = 5000;

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number; safe: boolean };

interface ApiFetchOptions {
  method?: "GET" | "POST";
  body?: unknown;
  userId?: string;
}

// console.error/console.warn, never console.log with the body/headers
// attached — method + path + status + cause only (round-6 REVIEW
// finding: every apiFetch failure previously vanished silently;
// `docker compose logs web` is the read-ground-truth command per
// reference.md and had nothing to show for a failed signup, task
// create, or session record). A 4xx is logged at warn — a wrong
// password or a duplicate signup is an expected, routine outcome, not
// an operational problem to page on (round-7 REVIEW nit).
function logFailure(method: string, path: string, status: number | undefined, cause: unknown) {
  const log = status !== undefined && status >= 400 && status < 500 ? console.warn : console.error;
  log(`apiFetch ${method} ${path} failed`, { status, cause: String(cause) });
}

export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<ApiResult<T>> {
  const method = options.method ?? "GET";
  const apiBaseUrl = process.env.API_BASE_URL;
  const internalSecret = process.env.INTERNAL_API_SECRET;
  if (!apiBaseUrl || !internalSecret) {
    logFailure(method, path, undefined, "API_BASE_URL or INTERNAL_API_SECRET unset");
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
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
      // Without this, a stalled apps/api (DB lock, saturated pool)
      // holds the request open for undici's 300s default instead of
      // failing fast into the same "couldn't reach the server" branch
      // a refused connection already hits.
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (cause) {
    logFailure(method, path, undefined, cause);
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
    logFailure(method, path, response.status, detail);
    // Not safe — this is apps/api's raw `detail` (or the generic
    // fallback), never vetted for end-user display.
    return { ok: false, error: detail, status: response.status, safe: false };
  }

  try {
    const data = (await response.json()) as T;
    return { ok: true, data };
  } catch (cause) {
    // A 2xx response whose body isn't valid JSON — apps/api never does
    // this today, but if it ever did, this used to throw out of
    // apiFetch entirely instead of returning the ApiResult every caller
    // checks with `if (!result.ok)` — the exact silent-failure shape
    // Blocker #1 (round-6 REVIEW) was raised against (round-7 follow-up:
    // the fix covered every failure branch except this one).
    logFailure(method, path, response.status, cause);
    return { ok: false, error: "request failed", status: response.status, safe: false };
  }
}

// A page or form rendering a failed result should not echo `error`
// unconditionally — some of apiFetch's own failure strings ("server
// misconfigured", apps/api's raw `detail`) aren't meant for an end
// user and could name what's broken in the deployment. `safe` is the
// explicit discriminant for that (round-4 REVIEW fix: an earlier
// version inferred safety from whether `status` was set, which
// misclassified "server misconfigured" — a safe-*looking* string with
// no status — as fine to show). `safe` is required, not optional
// (round-6 REVIEW fix: an optional flag defaulted to *showing* the
// message unless a caller explicitly opted out, the same fail-open
// shape as the bug this whole mechanism exists to prevent — every
// real caller already passes a full ApiResult failure branch, which
// requires `safe`, so nothing was actually relying on the default).
export function safeErrorMessage(result: { error: string; safe: boolean }): string {
  return result.safe ? result.error : "Something went wrong. Try again.";
}
