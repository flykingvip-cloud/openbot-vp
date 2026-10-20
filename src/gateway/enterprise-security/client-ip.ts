/**
 * Client IP for login, session reads, and allowlist checks.
 * Forwarded headers count only when the TCP peer is a configured trusted proxy.
 * That is the same rule as the websocket handshake (`resolveClientIp` in net.ts),
 * so a spoofed X-Forwarded-For cannot skip the allowlist.
 */
import type { IncomingMessage } from "node:http";
import { loadConfig } from "../../config/config.js";
import { resolveClientIp as resolveTrustedClientIp } from "../net.js";

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function normalizeClientIp(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  const unbracketed =
    trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
  const mapped = unbracketed.toLowerCase().startsWith("::ffff:")
    ? unbracketed.slice("::ffff:".length)
    : unbracketed;
  return mapped || undefined;
}

export function resolveClientIpFromRequest(req: IncomingMessage): string | undefined {
  let trustedProxies: string[] | undefined;
  let allowRealIpFallback = false;
  try {
    const gateway = loadConfig().gateway;
    trustedProxies = gateway?.trustedProxies;
    allowRealIpFallback = gateway?.allowRealIpFallback === true;
  } catch {
    // Unreadable config must not start trusting forwarded headers.
    trustedProxies = undefined;
    allowRealIpFallback = false;
  }
  return resolveTrustedClientIp({
    remoteAddr: req.socket?.remoteAddress,
    forwardedFor: headerValue(req.headers["x-forwarded-for"]),
    realIp: headerValue(req.headers["x-real-ip"]),
    trustedProxies,
    allowRealIpFallback,
  });
}
