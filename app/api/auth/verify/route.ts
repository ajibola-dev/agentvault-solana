import { NextResponse } from "next/server";
import { verifyMessage } from "viem";
import {
  AUTH_SESSION_COOKIE,
  createAuthMessage,
  normalizeAddress,
} from "@/lib/auth";
import { consumeNonce, createSession, hasNonce } from "@/lib/session-store";
import { getClientIp } from "@/lib/request-meta";
import { checkRateLimit } from "@/lib/rate-limit";
import { logAuditEvent } from "@/lib/audit-log";

type VerifyRequest = {
  address?: string;
  nonce?: string;
  signature?: string;
};

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const limit = await checkRateLimit({
    endpoint: "auth/verify",
    key: `ip:${ip}`,
    max: 15,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    logAuditEvent({
      endpoint: "auth/verify",
      action: "verify_signature",
      ip,
      status: "rate_limited",
      message: "Too many verify requests",
    });
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  try {
    const { address, nonce, signature } = await req.json() as VerifyRequest;

    if (!address || !nonce || !signature) {
      logAuditEvent({
        endpoint: "auth/verify",
        action: "verify_signature",
        ip,
        status: "validation_error",
        message: "Missing address, nonce, or signature",
      });
      return NextResponse.json({ error: "Missing address, nonce, or signature" }, { status: 400 });
    }

    const normalized = normalizeAddress(address);
    if (!normalized) {
      logAuditEvent({
        endpoint: "auth/verify",
        action: "verify_signature",
        ip,
        status: "validation_error",
        message: "Invalid address",
      });
      return NextResponse.json({ error: "Invalid address" }, { status: 400 });
    }

    if (!(await hasNonce(normalized, nonce))) {
      logAuditEvent({
        endpoint: "auth/verify",
        action: "verify_signature",
        actorAddress: normalized,
        ip,
        status: "validation_error",
        message: "Invalid or expired nonce",
      });
      return NextResponse.json({ error: "Invalid or expired nonce" }, { status: 400 });
    }

    const isValid = await verifyMessage({
      address: normalized as `0x${string}`,
      message: createAuthMessage(normalized, nonce),
      signature: signature as `0x${string}`,
    });

    if (!isValid) {
      logAuditEvent({
        endpoint: "auth/verify",
        action: "verify_signature",
        actorAddress: normalized,
        ip,
        status: "unauthorized",
        message: "Invalid signature",
      });
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    if (!(await consumeNonce(normalized, nonce))) {
      logAuditEvent({
        endpoint: "auth/verify",
        action: "verify_signature",
        actorAddress: normalized,
        ip,
        status: "validation_error",
        message: "Nonce already used",
      });
      return NextResponse.json({ error: "Nonce already used" }, { status: 400 });
    }

    const token = await createSession(normalized);
    const response = NextResponse.json({ ok: true, address: normalized });

    response.cookies.set({
      name: AUTH_SESSION_COOKIE,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24,
    });
    logAuditEvent({
      endpoint: "auth/verify",
      action: "verify_signature",
      actorAddress: normalized,
      ip,
      status: "success",
    });

    return response;
  } catch {
    logAuditEvent({
      endpoint: "auth/verify",
      action: "verify_signature",
      ip,
      status: "error",
      message: "Failed to verify signature",
    });
    return NextResponse.json({ error: "Failed to verify signature" }, { status: 500 });
  }
}
