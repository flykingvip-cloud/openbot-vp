import type { IncomingMessage } from "node:http";

function normalizePublicBaseUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return trimmed.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function splitPublicBaseUrlList(raw: string | undefined): string[] {
  if (!raw?.trim()) {
    return [];
  }
  return raw
    .split(",")
    .map((part) => normalizePublicBaseUrl(part))
    .filter((value): value is string => Boolean(value));
}

/**
 * Canonical public app base URL used for outbound links (emails, invites).
 * When `OPENBOT_PUBLIC_APP_BASE_URL` is a comma-separated list, the first entry wins.
 */
export function resolvePublicPlatformBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const urls = resolvePublicPlatformBaseUrls(env);
  return urls[0] ?? null;
}

/**
 * All configured public Control UI entry URLs that may call platform-auth via
 * the loopback reverse proxy (admin / biz / gw / apex / www).
 */
export function resolvePublicPlatformBaseUrls(env: NodeJS.ProcessEnv = process.env): string[] {
  const collected = [
    ...splitPublicBaseUrlList(env.OPENBOT_PUBLIC_APP_BASE_URLS),
    ...splitPublicBaseUrlList(env.OPENBOT_PUBLIC_APP_BASE_URL),
    ...splitPublicBaseUrlList(env.OPENBOT_PUBLIC_HOME_BASE_URL),
    ...splitPublicBaseUrlList(env.OPENBOT_PUBLIC_WEB_BASE_URL),
    ...splitPublicBaseUrlList(env.OPENBOT_PUBLIC_BASE_URL),
    ...splitPublicBaseUrlList(env.OPENCLAW_PUBLIC_APP_BASE_URLS),
    ...splitPublicBaseUrlList(env.OPENCLAW_PUBLIC_APP_BASE_URL),
    ...splitPublicBaseUrlList(env.OPENCLAW_PUBLIC_HOME_BASE_URL),
    ...splitPublicBaseUrlList(env.OPENCLAW_PUBLIC_WEB_BASE_URL),
    ...splitPublicBaseUrlList(env.OPENCLAW_PUBLIC_BASE_URL),
  ];
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const url of collected) {
    const key = url.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(url);
  }
  return unique;
}

function isLoopbackAddress(value: string | undefined): boolean {
  const normalized = value?.trim() ?? "";
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "::ffff:127.0.0.1";
}

function resolveRequestProto(req: IncomingMessage): string {
  const forwardedProto = Array.isArray(req.headers["x-forwarded-proto"])
    ? req.headers["x-forwarded-proto"][0]
    : req.headers["x-forwarded-proto"];
  if (typeof forwardedProto === "string" && forwardedProto.trim()) {
    return forwardedProto.trim().split(",")[0]?.trim() || "http";
  }
  return (req.socket as { encrypted?: boolean } | undefined)?.encrypted ? "https" : "http";
}

function resolveRequestHost(req: IncomingMessage): string {
  const forwardedHost = Array.isArray(req.headers["x-forwarded-host"])
    ? req.headers["x-forwarded-host"][0]
    : req.headers["x-forwarded-host"];
  if (typeof forwardedHost === "string" && forwardedHost.trim()) {
    return forwardedHost.trim().split(",")[0]?.trim() || "";
  }
  const host = Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host;
  return typeof host === "string" ? host.trim() : "";
}

/** True when nginx on the gateway host proxies with matching public Host/Proto headers. */
export function isConfiguredPublicPlatformRequest(req: IncomingMessage): boolean {
  const publicBaseUrls = resolvePublicPlatformBaseUrls();
  if (publicBaseUrls.length === 0) {
    return false;
  }
  const remoteAddress = req.socket?.remoteAddress;
  if (!isLoopbackAddress(remoteAddress)) {
    return false;
  }
  const requestProto = resolveRequestProto(req).toLowerCase();
  const requestHost = resolveRequestHost(req).toLowerCase();
  if (!requestHost) {
    return false;
  }
  return publicBaseUrls.some((publicBaseUrl) => {
    const expected = new URL(publicBaseUrl);
    return (
      requestProto === expected.protocol.replace(/:$/, "").toLowerCase() &&
      requestHost === expected.host.toLowerCase()
    );
  });
}

/** Local Control UI entry or trusted public reverse-proxy entry to the same gateway. */
export function isLocalOrConfiguredPublicPlatformAccess(params: {
  req: IncomingMessage;
  localDirect?: boolean;
}): boolean {
  return params.localDirect === true || isConfiguredPublicPlatformRequest(params.req);
}
