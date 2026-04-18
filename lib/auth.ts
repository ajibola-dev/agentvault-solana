import { getAddress, isAddress } from "viem";
import { getSessionAddress } from "@/lib/session-store";

export const AUTH_SESSION_COOKIE = "av_session";
export const AUTH_MESSAGE_PREFIX = "AgentVault Login";

export function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function normalizeAddress(address: string): string | null {
  if (!isAddress(address)) {
    return null;
  }
  return getAddress(address);
}

export function createAuthMessage(address: string, nonce: string): string {
  return [
    AUTH_MESSAGE_PREFIX,
    "",
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    "Sign this message to authenticate with AgentVault.",
  ].join("\n");
}

export function getSessionToken(req: Request): string | null {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }

  const parts = cookieHeader.split(";").map((p) => p.trim());
  const cookie = parts.find((p) => p.startsWith(`${AUTH_SESSION_COOKIE}=`));
  if (!cookie) {
    return null;
  }

  const value = cookie.slice(`${AUTH_SESSION_COOKIE}=`.length);
  return value || null;
}

export async function getAuthenticatedAddress(req: Request): Promise<string | null> {
  const token = getSessionToken(req);
  if (!token) {
    return null;
  }
  return getSessionAddress(token);
}
