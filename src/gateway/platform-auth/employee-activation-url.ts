import type { IncomingMessage } from "node:http";
import { normalizeEmail } from "./request-helpers.js";
import type { PlatformAuthStore } from "./store-types.js";

const EMPLOYEE_SURFACE_REWRITE_PREFIXES = ["admin", "biz", "gw"] as const;
export const EMPLOYEE_ACTIVATION_RESEND_WINDOW_MS = 90_000;

function firstPublicOrigin(raw: string | undefined): string | null {
  const first = raw?.split(",")[0]?.trim() ?? "";
  if (!first) {
    return null;
  }
  try {
    const parsed = new URL(first);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

/** Map admin/biz/gw console hosts onto the employee surface (www). */
function rewritePublicOriginToEmployeeSurface(raw: string | undefined): string | null {
  const origin = firstPublicOrigin(raw);
  if (!origin) {
    return null;
  }
  const parsed = new URL(origin);
  const host = parsed.hostname.toLowerCase();
  for (const prefix of EMPLOYEE_SURFACE_REWRITE_PREFIXES) {
    if (host === prefix) {
      parsed.hostname = "www";
      return parsed.origin;
    }
    if (host.startsWith(`${prefix}.`)) {
      parsed.hostname = `www.${host.slice(prefix.length + 1)}`;
      return parsed.origin;
    }
  }
  return parsed.origin;
}

function resolvePublicPlatformBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw =
    env.OPENBOT_PUBLIC_APP_BASE_URL?.trim() ||
    env.OPENBOT_PUBLIC_WEB_BASE_URL?.trim() ||
    env.OPENBOT_PUBLIC_BASE_URL?.trim() ||
    env.OPENCLAW_PUBLIC_APP_BASE_URL?.trim() ||
    env.OPENCLAW_PUBLIC_WEB_BASE_URL?.trim() ||
    env.OPENCLAW_PUBLIC_BASE_URL?.trim() ||
    "";
  return firstPublicOrigin(raw);
}

function resolveRequestOrigin(req: IncomingMessage): string {
  const publicBaseUrl = resolvePublicPlatformBaseUrl();
  if (publicBaseUrl) {
    return publicBaseUrl;
  }
  const forwardedProto = Array.isArray(req.headers["x-forwarded-proto"])
    ? req.headers["x-forwarded-proto"][0]
    : req.headers["x-forwarded-proto"];
  const proto =
    typeof forwardedProto === "string" && forwardedProto.trim()
      ? forwardedProto.trim().split(",")[0]?.trim() || "http"
      : (req.socket as { encrypted?: boolean } | undefined)?.encrypted
        ? "https"
        : "http";
  const forwardedHost = Array.isArray(req.headers["x-forwarded-host"])
    ? req.headers["x-forwarded-host"][0]
    : req.headers["x-forwarded-host"];
  const host =
    typeof forwardedHost === "string" && forwardedHost.trim()
      ? forwardedHost.trim().split(",")[0]?.trim()
      : Array.isArray(req.headers.host)
        ? req.headers.host[0]
        : req.headers.host;
  return `${proto || "http"}://${host?.trim() || "127.0.0.1:18789"}`;
}

/**
 * Deep link origin for employee activation (set password + claim code).
 * Always land on the employee surface. Never emit admin / biz / gw consoles,
 * even when HOME/EMPLOYEE env or the inbound request host is mis-set.
 */
export function resolveEmployeeActivationOrigin(
  req: IncomingMessage,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const candidates = [
    env.OPENBOT_PUBLIC_EMPLOYEE_BASE_URL,
    env.OPENCLAW_PUBLIC_EMPLOYEE_BASE_URL,
    env.OPENBOT_PUBLIC_HOME_BASE_URL,
    env.OPENCLAW_PUBLIC_HOME_BASE_URL,
    resolvePublicPlatformBaseUrl(env),
    resolveRequestOrigin(req),
  ];
  for (const candidate of candidates) {
    const origin = rewritePublicOriginToEmployeeSurface(candidate ?? undefined);
    if (origin) {
      return origin;
    }
  }
  return "https://www.openbot.love";
}

export function hasRecentlySentEmployeeActivationEmail(params: {
  store: PlatformAuthStore;
  email: string;
  enterpriseId: string;
  nowMs?: number;
  windowMs?: number;
}): boolean {
  const normalized = normalizeEmail(params.email);
  const cutoff =
    (params.nowMs ?? Date.now()) - (params.windowMs ?? EMPLOYEE_ACTIVATION_RESEND_WINDOW_MS);
  return Object.values(params.store.leadNotifications).some((notification) => {
    if (notification.type !== "employee-activation-email" || notification.status !== "sent") {
      return false;
    }
    if (notification.enterpriseId !== params.enterpriseId) {
      return false;
    }
    if (normalizeEmail(notification.email ?? "") !== normalized) {
      return false;
    }
    const deliveredAt = notification.deliveredAt ?? notification.createdAt;
    const deliveredMs = Date.parse(deliveredAt);
    return Number.isFinite(deliveredMs) && deliveredMs >= cutoff;
  });
}

export function buildEmployeeActivationUrl(params: {
  req: IncomingMessage;
  basePath?: string;
  code: string;
  email?: string;
  employeeName?: string;
}): string {
  const normalizedBase = params.basePath?.trim().replace(/\/+$/, "") ?? "";
  const url = new URL(`${normalizedBase || ""}/me`, resolveEmployeeActivationOrigin(params.req));
  url.searchParams.set("authMode", "employee-register");
  url.searchParams.set("code", params.code);
  const email = params.email?.trim();
  if (email) {
    url.searchParams.set("email", email);
  }
  const employeeName = params.employeeName?.trim();
  if (employeeName && (!email || employeeName.toLowerCase() !== email.toLowerCase())) {
    url.searchParams.set("name", employeeName);
  }
  url.hash = "auth";
  return url.toString();
}
