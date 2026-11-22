import { createHmac } from "node:crypto";
import type { IncomingMessage } from "node:http";

function isSecureRequest(req: IncomingMessage): boolean {
  const forwardedProto = Array.isArray(req.headers["x-forwarded-proto"])
    ? req.headers["x-forwarded-proto"][0]
    : req.headers["x-forwarded-proto"];
  if (typeof forwardedProto === "string" && forwardedProto.trim().toLowerCase() === "https") {
    return true;
  }
  return Boolean((req.socket as { encrypted?: boolean } | undefined)?.encrypted);
}

function signSessionToken(secret: string, sessionId: string): string {
  return createHmac("sha256", secret).update(sessionId).digest("base64url");
}

export function buildSessionCookieValue(secret: string, sessionId: string): string {
  return `${sessionId}.${signSessionToken(secret, sessionId)}`;
}

function assertCookieDomainMatchesRequest(req: IncomingMessage, cookieDomain: string): void {
  const rawHost = Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host;
  const hostname = rawHost?.trim().toLowerCase().replace(/:\d+$/, "") ?? "";
  if (hostname !== cookieDomain && !hostname.endsWith(`.${cookieDomain}`)) {
    throw new Error("platform auth cookieDomain does not match the request host");
  }
}

export function buildCookieHeader(
  req: IncomingMessage,
  cookieName: string,
  value: string,
  maxAgeSeconds: number,
  cookieDomain?: string,
): string {
  const attributes = [
    `${cookieName}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  if (cookieDomain) {
    assertCookieDomainMatchesRequest(req, cookieDomain);
    attributes.push(`Domain=${cookieDomain}`);
  }
  if (isSecureRequest(req)) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

export function buildClearedCookieHeader(
  req: IncomingMessage,
  cookieName: string,
  cookieDomain?: string,
): string {
  const attributes = [`${cookieName}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (cookieDomain) {
    assertCookieDomainMatchesRequest(req, cookieDomain);
    attributes.push(`Domain=${cookieDomain}`);
  }
  if (isSecureRequest(req)) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}
