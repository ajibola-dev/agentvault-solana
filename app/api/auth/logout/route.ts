import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, getSessionToken } from "@/lib/auth";
import { invalidateSession } from "@/lib/session-store";
import { getClientIp } from "@/lib/request-meta";
import { checkRateLimit } from "@/lib/rate-limit";
import { logAuditEvent } from "@/lib/audit-log";

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const limit = await checkRateLimit({
    endpoint: "auth/logout",
    key: `ip:${ip}`,
    max: 30,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    logAuditEvent({
      endpoint: "auth/logout",
      action: "logout",
      ip,
      status: "rate_limited",
      message: "Too many logout requests",
    });
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  const token = getSessionToken(req);
  if (token) {
    await invalidateSession(token);
  }
  logAuditEvent({
    endpoint: "auth/logout",
    action: "logout",
    ip,
    status: "success",
  });

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: AUTH_SESSION_COOKIE,
    value: "",
    path: "/",
    maxAge: 0,
  });

  return response;
}
