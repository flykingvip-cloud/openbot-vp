import type { IncomingMessage } from "node:http";
import { resolvePublicPlatformBaseUrl } from "./public-request.js";

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
 * Deep link for enterprise-admin activation (set password + claim invite).
 * Prefer biz console origin — never admin/platform console origin.
 */
export function resolveEnterpriseAdminActivationOrigin(req: IncomingMessage): string {
  const explicit =
    process.env.OPENBOT_PUBLIC_ENTERPRISE_BASE_URL?.trim() ||
    process.env.OPENCLAW_PUBLIC_ENTERPRISE_BASE_URL?.trim() ||
    "";
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }
  const platform = resolvePublicPlatformBaseUrl();
  if (platform) {
    try {
      const parsed = new URL(platform);
      const host = parsed.hostname.toLowerCase();
      for (const prefix of ["admin", "gw", "www"]) {
        if (host.startsWith(`${prefix}.`)) {
          parsed.hostname = `biz.${host.slice(prefix.length + 1)}`;
          return parsed.origin;
        }
      }
      if (host.startsWith("biz.")) {
        return parsed.origin;
      }
    } catch {
      // fall through
    }
  }
  try {
    const fromReq = new URL(resolveRequestOrigin(req));
    const host = fromReq.hostname.toLowerCase();
    for (const prefix of ["admin", "gw", "www"]) {
      if (host.startsWith(`${prefix}.`)) {
        fromReq.hostname = `biz.${host.slice(prefix.length + 1)}`;
        return fromReq.origin;
      }
    }
    return fromReq.origin;
  } catch {
    return resolveRequestOrigin(req);
  }
}

export function buildEnterpriseAdminActivationUrl(params: {
  req: IncomingMessage;
  basePath?: string;
  code: string;
  email?: string;
  adminName?: string;
}): string {
  const normalizedBase = params.basePath?.trim().replace(/\/+$/, "") ?? "";
  const url = new URL(
    `${normalizedBase || ""}/enterprise/login`,
    resolveEnterpriseAdminActivationOrigin(params.req),
  );
  url.searchParams.set("authMode", "enterprise-activate");
  url.searchParams.set("code", params.code);
  const email = params.email?.trim();
  if (email) {
    url.searchParams.set("email", email);
  }
  const adminName = params.adminName?.trim();
  if (adminName && (!email || adminName.toLowerCase() !== email.toLowerCase())) {
    url.searchParams.set("name", adminName);
  }
  url.hash = "auth";
  return url.toString();
}
