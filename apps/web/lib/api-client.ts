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
// attached — method + path + status + cause only. A 4xx is routine
// (warn) except a 401 whose `detail` is exactly "invalid internal
// secret" — apps/api only ever returns that from require_internal_secret
// (apps/api/app/core/security.py), i.e. a broken web<->api deployment,
// not a user mistake — which logs at error. Full round-by-round history
// of this carve-out (why detail-based rather than path-based, why this
// exact string) is in docs/specs/walking-skeleton/plan.md's changelog
// (rounds 6-8, 16, 17), not restated here.
function logFailure(method: string, path: string, status: number | undefined, cause: unknown) {
  const isInternalSecretMismatch = status === 401 && cause === "invalid internal secret";
  const isRoutine =
    !isInternalSecretMismatch && status !== undefined && status >= 400 && status < 500;
  const log = isRoutine ? console.warn : console.error;
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

  // 204 No Content (POST /timer/stop) has no body to parse.
  if (response.status === 204) {
    return { ok: true, data: undefined as T };
  }

  try {
    const data = (await response.json()) as T;
    return { ok: true, data };
  } catch {
    // A 2xx response whose body isn't valid JSON — apps/api never does
    // this today, but if it ever did, this used to throw out of
    // apiFetch entirely instead of returning the ApiResult every caller
    // checks with `if (!result.ok)` — the exact silent-failure shape
    // Blocker #1 (round-6 REVIEW) was raised against (round-7 follow-up:
    // the fix covered every failure branch except this one). Logged
    // with a static cause, not the caught error itself (round-8 REVIEW
    // nit): V8's JSON.parse SyntaxError embeds the first ~10 bytes of
    // the offending body in its message, which `String(cause)` would
    // have written straight to the log — exactly the body-content leak
    // this module's own docblock rules out.
    logFailure(method, path, response.status, "response body was not valid JSON");
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
