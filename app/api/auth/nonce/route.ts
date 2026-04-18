import { NextResponse } from "next/server";
import { createAuthMessage, normalizeAddress } from "@/lib/auth";
import { issueNonce } from "@/lib/session-store";
import { getClientIp } from "@/lib/request-meta";
import { checkRateLimit } from "@/lib/rate-limit";
import { logAuditEvent } from "@/lib/audit-log";

type NonceRequest = {
  address?: string;
};

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const limit = await checkRateLimit({
    endpoint: "auth/nonce",
    key: `ip:${ip}`,
    max: 20,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    logAuditEvent({
      endpoint: "auth/nonce",
      action: "issue_nonce",
      ip,
      status: "rate_limited",
      message: "Too many nonce requests",
    });
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  try {
    const { address } = await req.json() as NonceRequest;
    if (!address) {
      logAuditEvent({
        endpoint: "auth/nonce",
        action: "issue_nonce",
        ip,
        status: "validation_error",
        message: "Missing address",
      });
      return NextResponse.json({ error: "Missing address" }, { status: 400 });
    }

    const normalized = normalizeAddress(address);
    if (!normalized) {
      logAuditEvent({
        endpoint: "auth/nonce",
        action: "issue_nonce",
        ip,
        status: "validation_error",
        message: "Invalid address",
      });
      return NextResponse.json({ error: "Invalid address" }, { status: 400 });
    }

    const nonce = await issueNonce(normalized);
    const message = createAuthMessage(normalized, nonce);
    logAuditEvent({
      endpoint: "auth/nonce",
      action: "issue_nonce",
      actorAddress: normalized,
      ip,
      status: "success",
    });

    return NextResponse.json({ nonce, message, address: normalized });
  } catch {
    logAuditEvent({
      endpoint: "auth/nonce",
      action: "issue_nonce",
      ip,
      status: "error",
      message: "Failed to issue nonce",
    });
    return NextResponse.json({ error: "Failed to issue nonce" }, { status: 500 });
  }
}
