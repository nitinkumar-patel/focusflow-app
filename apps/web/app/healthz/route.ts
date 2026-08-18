import { NextResponse } from "next/server";

// Calls the API's own /healthz internally and only returns 200 if that
// succeeds — one curl through Nginx then proves web, api, and the
// database are all wired correctly (plan.md T1 Design decisions).
//
// This is the one health-check path unauthenticated visitors can reach
// through Nginx, so — unlike apiFetch's ApiResult/safe mechanism, which
// this route never went through — it never returns *why* it failed
// (round-6 REVIEW finding: an earlier version returned "API_BASE_URL
// unset"/"api unreachable" directly, the exact class of deployment-
// detail leak the rest of the codebase spent five review rounds
// closing). The cause still goes to the server log.
export async function GET() {
  const apiBaseUrl = process.env.API_BASE_URL;
  if (!apiBaseUrl) {
    console.error("web /healthz failed", { cause: "API_BASE_URL unset" });
    return NextResponse.json({ status: "error" }, { status: 503 });
  }

  try {
    const res = await fetch(`${apiBaseUrl}/healthz`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      return NextResponse.json({ status: "ok" }, { status: 200 });
    }
    console.error("web /healthz failed", { cause: `api responded ${res.status}` });
    return NextResponse.json({ status: "error" }, { status: 503 });
  } catch (cause) {
    console.error("web /healthz failed", { cause: String(cause) });
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
