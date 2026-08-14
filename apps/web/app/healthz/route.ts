import { NextResponse } from "next/server";

// Calls the API's own /healthz internally and only returns 200 if that
// succeeds — one curl through Nginx then proves web, api, and the
// database are all wired correctly (plan.md T1 Design decisions).
export async function GET() {
  const apiBaseUrl = process.env.API_BASE_URL;
  if (!apiBaseUrl) {
    return NextResponse.json({ status: "error", detail: "API_BASE_URL unset" }, { status: 503 });
  }

  try {
    const res = await fetch(`${apiBaseUrl}/healthz`, { cache: "no-store" });
    if (res.ok) {
      return NextResponse.json({ status: "ok" }, { status: 200 });
    }
    return NextResponse.json({ status: "error", detail: "api unhealthy" }, { status: 503 });
  } catch {
    return NextResponse.json({ status: "error", detail: "api unreachable" }, { status: 503 });
  }
}
