// The single wrapper every Server Action calls apps/api through — attaches
// X-Internal-Secret / X-User-Id, normalizes errors. Never includes the
// request body or headers (which may carry a password or the internal
// secret) in a thrown error or log line — spec AC11 (web half).

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

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
    return { ok: false, error: "server misconfigured" };
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
    return { ok: false, error: "couldn't reach the server, try again" };
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
    return { ok: false, error: detail, status: response.status };
  }

  const data = (await response.json()) as T;
  return { ok: true, data };
}

// A page rendering a failed ApiResult should not echo it unconditionally
// — `status` set means apps/api returned a real HTTP error response,
// whose `detail` (or "server misconfigured"/"request failed") isn't
// meant for an end user and could name what's broken in the deployment.
// No `status` means apiFetch never got a response at all (network
// failure) or the caller's own pre-flight check failed (e.g. "You must
// be logged in.") — both of those strings are already safe, static
// copy written for display (round-3 REVIEW finding).
export function safeErrorMessage(result: { error: string; status?: number }): string {
  return result.status === undefined ? result.error : "Something went wrong. Try again.";
}
