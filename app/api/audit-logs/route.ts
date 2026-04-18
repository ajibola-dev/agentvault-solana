import { NextResponse } from "next/server";
import { getAuthenticatedAddress } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { listAuditLogsDurable, logAuditEvent } from "@/lib/audit-log";
import { getClientIp } from "@/lib/request-meta";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const ip = getClientIp(req);
  const limitResult = await checkRateLimit({
    endpoint: "audit/logs",
    key: `ip:${ip}`,
    max: 20,
    windowMs: 60_000,
  });
  if (!limitResult.allowed) {
    logAuditEvent({
      endpoint: "audit/logs",
      action: "list_audit_logs",
      ip,
      status: "rate_limited",
      message: "Too many audit log requests",
    });
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(limitResult.retryAfterSeconds) } }
    );
  }

  const callerAddress = await getAuthenticatedAddress(req);
  if (!callerAddress) {
    logAuditEvent({
      endpoint: "audit/logs",
      action: "list_audit_logs",
      ip,
      status: "unauthorized",
      message: "Missing auth session",
    });
    return NextResponse.json({ error: "Unauthorized: sign in with wallet first" }, { status: 401 });
  }

  const actorLimit = await checkRateLimit({
    endpoint: "audit/logs",
    key: `actor:${callerAddress.toLowerCase()}`,
    max: 20,
    windowMs: 60_000,
  });
  if (!actorLimit.allowed) {
    logAuditEvent({
      endpoint: "audit/logs",
      action: "list_audit_logs",
      actorAddress: callerAddress,
      ip,
      status: "rate_limited",
      message: "Too many audit log requests for this wallet",
    });
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(actorLimit.retryAfterSeconds) } }
    );
  }

  const parsedUrl = new URL(req.url);
  const limitParam = Number(parsedUrl.searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(200, limitParam)) : 100;
  const logs = await listAuditLogsDurable(limit, callerAddress);

  logAuditEvent({
    endpoint: "audit/logs",
    action: "list_audit_logs",
    actorAddress: callerAddress,
    ip,
    status: "success",
    metadata: { count: logs.length },
  });

  return NextResponse.json({ logs });
}
