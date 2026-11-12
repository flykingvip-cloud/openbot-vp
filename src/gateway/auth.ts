import type { IncomingMessage } from "node:http";
import type {
  GatewayAuthConfig,
  GatewayTailscaleMode,
  GatewayTrustedProxyConfig,
} from "../config/config.js";
import { resolveSecretInputRef } from "../config/types.secrets.js";
import { readTailscaleWhoisIdentity, type TailscaleWhoisIdentity } from "../infra/tailscale.js";
import { safeEqualSecret } from "../security/secret-equal.js";
import {
  AUTH_RATE_LIMIT_SCOPE_SHARED_SECRET,
  type AuthRateLimiter,
  type RateLimitCheckResult,
} from "./auth-rate-limit.js";
import { resolveGatewayCredentialsFromValues } from "./credentials.js";
import {
  isLocalishHost,
  isLoopbackAddress,
  isTrustedProxyAddress,
  resolveClientIp,
} from "./net.js";
import {
  loadPlatformAuthStore,
  readPlatformAuthSessionFromRequest,
  resolvePlatformAuthConfig,
} from "./platform-auth.js";
import { resolveOperatorSessionFromStore } from "./platform-auth/loopback-operator.js";
import type { PlatformAuthTrustedProxySession } from "./platform-auth/store-types.js";
import { parseGatewayRole, type GatewayRole } from "./role-policy.js";

export type ResolvedGatewayAuthMode = "none" | "token" | "password" | "trusted-proxy";
export type ResolvedGatewayAuthModeSource =
  | "override"
  | "config"
  | "password"
  | "token"
  | "default"
  | "platform-auth";

export type ResolvedGatewayAuth = {
  mode: ResolvedGatewayAuthMode;
  modeSource?: ResolvedGatewayAuthModeSource;
  token?: string;
  password?: string;
  allowTailscale: boolean;
  trustedProxy?: GatewayTrustedProxyConfig;
};

export type GatewayAuthResult = {
  ok: boolean;
  method?: "none" | "token" | "password" | "tailscale" | "device-token" | "trusted-proxy";
  user?: string;
  trustedProxy?: GatewayTrustedProxySession;
  reason?: string;
  /** Present when the request was blocked by the rate limiter. */
  rateLimited?: boolean;
  /** Milliseconds the client should wait before retrying (when rate-limited). */
  retryAfterMs?: number;
};

export type GatewayTrustedProxySession = {
  provider: "trusted-proxy";
  user: string;
  displayName?: string;
  tenantId?: string;
  role?: GatewayRole;
  scopes?: string[];
  /**
   * Session domain ("platform" | "enterprise" | "employee") for RPC domain
   * isolation. Populated for platform-auth-backed sessions; undefined for
   * header-only trusted-proxy sessions (the domain guard treats undefined as
   * "any" so legacy deployments are unaffected).
   */
  domain?: "platform" | "enterprise" | "employee";
};

type ConnectAuth = {
  token?: string;
  password?: string;
};

export type GatewayAuthSurface = "http" | "ws-control-ui";

export type AuthorizeGatewayConnectParams = {
  auth: ResolvedGatewayAuth;
  connectAuth?: ConnectAuth | null;
  req?: IncomingMessage;
  trustedProxies?: string[];
  tailscaleWhois?: TailscaleWhoisLookup;
  /**
   * Explicit auth surface. HTTP keeps Tailscale forwarded-header auth disabled.
   * WS Control UI enables it intentionally for tokenless trusted-host login.
   */
  authSurface?: GatewayAuthSurface;
  /** Optional rate limiter instance; when provided, failed attempts are tracked per IP. */
  rateLimiter?: AuthRateLimiter;
  /** Client IP used for rate-limit tracking. Falls back to proxy-aware request IP resolution. */
  clientIp?: string;
  /** Optional limiter scope; defaults to shared-secret auth scope. */
  rateLimitScope?: string;
  /** Trust X-Real-IP only when explicitly enabled. */
  allowRealIpFallback?: boolean;
};

type TailscaleUser = {
  login: string;
  name: string;
  profilePic?: string;
};

type TailscaleWhoisLookup = (ip: string) => Promise<TailscaleWhoisIdentity | null>;

function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function trimmedHeaderValue(
  headers: IncomingMessage["headers"] | undefined,
  headerName: string | undefined,
): string | undefined {
  const normalizedName = headerName?.trim().toLowerCase();
  if (!normalizedName) {
    return undefined;
  }
  const value = headerValue(headers?.[normalizedName]);
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseTrustedProxyScopes(value: string | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value.trim()) {
    return [];
  }
  const seen = new Set<string>();
  const scopes: string[] = [];
  for (const scope of value.split(/[,\s]+/)) {
    const normalized = scope.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    scopes.push(normalized);
  }
  return scopes;
}

const TAILSCALE_TRUSTED_PROXIES = ["127.0.0.1", "::1"] as const;

/** Default header used by a designated isolation entry hop in tight mode. */
export const DEFAULT_ENTRY_HOP_HEADER = "x-openbot-entry-hop";

/**
 * Isolation tight-path check. When `rejectDirectLoopbackIdentityHeaders` is
 * enabled, a peer that is merely loopback must not be able to assume an
 * arbitrary user by sending `userHeader`. A matching entry hop credential
 * is the documented exception so a designated 模拟入口 can still present
 * identity headers. Default / production-shaped configs leave the flag
 * unset and this function returns false.
 */
export function shouldRejectDirectLoopbackIdentityHeaders(params: {
  req?: IncomingMessage;
  trustedProxyConfig: GatewayTrustedProxyConfig;
}): boolean {
  if (!params.trustedProxyConfig.rejectDirectLoopbackIdentityHeaders) {
    return false;
  }
  if (!params.req) {
    return true;
  }
  if (!isLoopbackAddress(params.req.socket?.remoteAddress)) {
    return false;
  }
  const expected = params.trustedProxyConfig.entryHopCredential;
  if (typeof expected !== "string" || expected.length === 0) {
    return true;
  }
  const headerName = (
    params.trustedProxyConfig.entryHopHeader?.trim() || DEFAULT_ENTRY_HOP_HEADER
  ).toLowerCase();
  const provided = headerValue(params.req.headers[headerName]);
  if (typeof provided !== "string" || provided.length === 0) {
    return true;
  }
  return !safeEqualSecret(provided, expected);
}

function resolveTailscaleClientIp(req?: IncomingMessage): string | undefined {
  if (!req) {
    return undefined;
  }
  return resolveClientIp({
    remoteAddr: req.socket?.remoteAddress ?? "",
    forwardedFor: headerValue(req.headers?.["x-forwarded-for"]),
    trustedProxies: [...TAILSCALE_TRUSTED_PROXIES],
  });
}

function resolveRequestClientIp(
  req?: IncomingMessage,
  trustedProxies?: string[],
  allowRealIpFallback = false,
): string | undefined {
  if (!req) {
    return undefined;
  }
  return resolveClientIp({
    remoteAddr: req.socket?.remoteAddress ?? "",
    forwardedFor: headerValue(req.headers?.["x-forwarded-for"]),
    realIp: headerValue(req.headers?.["x-real-ip"]),
    trustedProxies,
    allowRealIpFallback,
  });
}

export function isLocalDirectRequest(
  req?: IncomingMessage,
  trustedProxies?: string[],
  allowRealIpFallback = false,
): boolean {
  if (!req) {
    return false;
  }
  const hasForwarded = Boolean(
    req.headers?.["x-forwarded-for"] ||
    req.headers?.["x-real-ip"] ||
    req.headers?.["x-forwarded-host"],
  );

  const remoteAddress = req.socket?.remoteAddress;
  const remoteIsTrustedProxy = isTrustedProxyAddress(remoteAddress, trustedProxies);
  if (!isLocalishHost(req.headers?.host) || (hasForwarded && !remoteIsTrustedProxy)) {
    return false;
  }

  const clientIp = resolveRequestClientIp(req, trustedProxies, allowRealIpFallback);
  if (clientIp) {
    return isLoopbackAddress(clientIp);
  }

  // Direct loopback requests remain local even when loopback is listed as a
  // trusted proxy. In that case resolveClientIp() intentionally returns
  // undefined because there are no forwarded headers to trust.
  return !hasForwarded && isLoopbackAddress(remoteAddress);
}

function getTailscaleUser(req?: IncomingMessage): TailscaleUser | null {
  if (!req) {
    return null;
  }
  const login = req.headers["tailscale-user-login"];
  if (typeof login !== "string" || !login.trim()) {
    return null;
  }
  const nameRaw = req.headers["tailscale-user-name"];
  const profilePic = req.headers["tailscale-user-profile-pic"];
  const name = typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim() : login.trim();
  return {
    login: login.trim(),
    name,
    profilePic: typeof profilePic === "string" && profilePic.trim() ? profilePic.trim() : undefined,
  };
}

function hasTailscaleProxyHeaders(req?: IncomingMessage): boolean {
  if (!req) {
    return false;
  }
  return Boolean(
    req.headers["x-forwarded-for"] &&
    req.headers["x-forwarded-proto"] &&
    req.headers["x-forwarded-host"],
  );
}

function isTailscaleProxyRequest(req?: IncomingMessage): boolean {
  if (!req) {
    return false;
  }
  return isLoopbackAddress(req.socket?.remoteAddress) && hasTailscaleProxyHeaders(req);
}

async function resolveVerifiedTailscaleUser(params: {
  req?: IncomingMessage;
  tailscaleWhois: TailscaleWhoisLookup;
}): Promise<{ ok: true; user: TailscaleUser } | { ok: false; reason: string }> {
  const { req, tailscaleWhois } = params;
  const tailscaleUser = getTailscaleUser(req);
  if (!tailscaleUser) {
    return { ok: false, reason: "tailscale_user_missing" };
  }
  if (!isTailscaleProxyRequest(req)) {
    return { ok: false, reason: "tailscale_proxy_missing" };
  }
  const clientIp = resolveTailscaleClientIp(req);
  if (!clientIp) {
    return { ok: false, reason: "tailscale_whois_failed" };
  }
  const whois = await tailscaleWhois(clientIp);
  if (!whois?.login) {
    return { ok: false, reason: "tailscale_whois_failed" };
  }
  if (normalizeLogin(whois.login) !== normalizeLogin(tailscaleUser.login)) {
    return { ok: false, reason: "tailscale_user_mismatch" };
  }
  return {
    ok: true,
    user: {
      login: whois.login,
      name: whois.name ?? tailscaleUser.name,
      profilePic: tailscaleUser.profilePic,
    },
  };
}

export function resolveGatewayAuth(params: {
  authConfig?: GatewayAuthConfig | null;
  authOverride?: GatewayAuthConfig | null;
  env?: NodeJS.ProcessEnv;
  tailscaleMode?: GatewayTailscaleMode;
}): ResolvedGatewayAuth {
  const baseAuthConfig = params.authConfig ?? {};
  const authOverride = params.authOverride ?? undefined;
  const authConfig: GatewayAuthConfig = { ...baseAuthConfig };
  if (authOverride) {
    if (authOverride.mode !== undefined) {
      authConfig.mode = authOverride.mode;
    }
    if (authOverride.token !== undefined) {
      authConfig.token = authOverride.token;
    }
    if (authOverride.password !== undefined) {
      authConfig.password = authOverride.password;
    }
    if (authOverride.allowTailscale !== undefined) {
      authConfig.allowTailscale = authOverride.allowTailscale;
    }
    if (authOverride.rateLimit !== undefined) {
      authConfig.rateLimit = authOverride.rateLimit;
    }
    if (authOverride.trustedProxy !== undefined) {
      authConfig.trustedProxy = authOverride.trustedProxy;
    }
  }
  const env = params.env ?? process.env;
  const tokenRef = resolveSecretInputRef({ value: authConfig.token }).ref;
  const passwordRef = resolveSecretInputRef({ value: authConfig.password }).ref;
  const resolvedCredentials = resolveGatewayCredentialsFromValues({
    configToken: tokenRef ? undefined : authConfig.token,
    configPassword: passwordRef ? undefined : authConfig.password,
    env,
    includeLegacyEnv: false,
    tokenPrecedence: "config-first",
    passwordPrecedence: "config-first", // pragma: allowlist secret
  });
  const token = resolvedCredentials.token;
  const password = resolvedCredentials.password;
  const trustedProxy = authConfig.trustedProxy;

  let mode: ResolvedGatewayAuth["mode"];
  let modeSource: ResolvedGatewayAuth["modeSource"];
  if (authOverride?.mode !== undefined) {
    mode = authOverride.mode;
    modeSource = "override";
  } else if (authConfig.mode) {
    mode = authConfig.mode;
    modeSource = "config";
  } else if (resolvePlatformAuthConfig(trustedProxy)) {
    mode = "trusted-proxy";
    modeSource = "platform-auth";
  } else if (password) {
    mode = "password";
    modeSource = "password";
  } else if (token) {
    mode = "token";
    modeSource = "token";
  } else {
    mode = "token";
    modeSource = "default";
  }

  const allowTailscale =
    authConfig.allowTailscale ??
    (params.tailscaleMode === "serve" && mode !== "password" && mode !== "trusted-proxy");

  return {
    mode,
    modeSource,
    token,
    password,
    allowTailscale,
    trustedProxy,
  };
}

export function assertGatewayAuthConfigured(
  auth: ResolvedGatewayAuth,
  rawAuthConfig?: GatewayAuthConfig | null,
): void {
  if (auth.mode === "token" && !auth.token) {
    if (auth.allowTailscale) {
      return;
    }
    throw new Error(
      "gateway auth mode is token, but no token was configured (set gateway.auth.token or OPENCLAW_GATEWAY_TOKEN)",
    );
  }
  if (auth.mode === "password" && !auth.password) {
    if (
      rawAuthConfig?.password != null && // pragma: allowlist secret
      typeof rawAuthConfig.password !== "string" // pragma: allowlist secret
    ) {
      throw new Error(
        "gateway auth mode is password, but gateway.auth.password contains a provider reference object instead of a resolved string — bootstrap secrets (gateway.auth.password) must be plaintext strings or set via the OPENCLAW_GATEWAY_PASSWORD environment variable because the secrets provider system has not initialised yet at gateway startup", // pragma: allowlist secret
      );
    }
    throw new Error("gateway auth mode is password, but no password was configured");
  }
  if (auth.mode === "trusted-proxy") {
    if (!auth.trustedProxy) {
      throw new Error(
        "gateway auth mode is trusted-proxy, but no trustedProxy config was provided (set gateway.auth.trustedProxy)",
      );
    }
    if (!auth.trustedProxy.userHeader || auth.trustedProxy.userHeader.trim() === "") {
      throw new Error(
        "gateway auth mode is trusted-proxy, but trustedProxy.userHeader is empty (set gateway.auth.trustedProxy.userHeader)",
      );
    }
  }
}

/**
 * Check if the request came from a trusted proxy and extract user identity.
 * Returns the user identity if valid, or null with a reason if not.
 */
function authorizeTrustedProxy(params: {
  req?: IncomingMessage;
  trustedProxies?: string[];
  trustedProxyConfig: GatewayTrustedProxyConfig;
}): { session: GatewayTrustedProxySession } | { reason: string } {
  const { req, trustedProxies, trustedProxyConfig } = params;

  if (!req) {
    return { reason: "trusted_proxy_no_request" };
  }

  const remoteAddr = req.socket?.remoteAddress;
  if (!remoteAddr || !isTrustedProxyAddress(remoteAddr, trustedProxies)) {
    return { reason: "trusted_proxy_untrusted_source" };
  }

  const requiredHeaders = trustedProxyConfig.requiredHeaders ?? [];
  for (const header of requiredHeaders) {
    const value = headerValue(req.headers[header.toLowerCase()]);
    if (!value || value.trim() === "") {
      return { reason: `trusted_proxy_missing_header_${header}` };
    }
  }

  const user = trimmedHeaderValue(req.headers, trustedProxyConfig.userHeader);
  if (shouldRejectDirectLoopbackIdentityHeaders({ req, trustedProxyConfig }) && user) {
    return { reason: "trusted_proxy_loopback_identity_rejected" };
  }
  if (!user) {
    return { reason: "trusted_proxy_user_missing" };
  }

  const allowUsers = trustedProxyConfig.allowUsers ?? [];
  if (allowUsers.length > 0 && !allowUsers.includes(user)) {
    return { reason: "trusted_proxy_user_not_allowed" };
  }

  const roleValue = trimmedHeaderValue(req.headers, trustedProxyConfig.roleHeader);
  const role = roleValue ? parseGatewayRole(roleValue) : undefined;
  if (roleValue && !role) {
    return { reason: "trusted_proxy_invalid_role" };
  }

  const session: GatewayTrustedProxySession = {
    provider: "trusted-proxy",
    user,
    displayName: trimmedHeaderValue(req.headers, trustedProxyConfig.displayNameHeader),
    tenantId: trimmedHeaderValue(req.headers, trustedProxyConfig.tenantHeader),
    ...(role ? { role } : {}),
  };
  const scopes = parseTrustedProxyScopes(
    trustedProxyConfig.scopesHeader === undefined
      ? undefined
      : headerValue(req.headers[trustedProxyConfig.scopesHeader.toLowerCase()]),
  );
  if (scopes !== undefined) {
    session.scopes = scopes;
  }

  return { session };
}

function shouldAllowTailscaleHeaderAuth(authSurface: GatewayAuthSurface): boolean {
  return authSurface === "ws-control-ui";
}

export function isPlatformBrowserAuthEnabled(
  trustedProxy: GatewayTrustedProxyConfig | undefined,
): boolean {
  return resolvePlatformAuthConfig(trustedProxy) !== null;
}

/** Browser-facing auth mode: platform/BFF session is authoritative when platform auth is enabled. */
export function resolveControlUiBrowserAuthMode(
  auth: Pick<ResolvedGatewayAuth, "mode" | "trustedProxy">,
): ResolvedGatewayAuthMode {
  if (isPlatformBrowserAuthEnabled(auth.trustedProxy)) {
    return "trusted-proxy";
  }
  return auth.mode;
}

async function authorizePlatformSessionConnect(params: {
  req?: IncomingMessage;
  trustedProxy: GatewayTrustedProxyConfig | undefined;
  localDirect: boolean;
  /** When false, honor platform sessions even if platformAuth is not explicitly enabled (auth.mode=none seam). */
  requirePlatformAuthConfig?: boolean;
}): Promise<GatewayAuthResult | null> {
  if (!params.req) {
    return null;
  }
  if (
    params.requirePlatformAuthConfig !== false &&
    !isPlatformBrowserAuthEnabled(params.trustedProxy)
  ) {
    return null;
  }
  const platformSession = await readPlatformAuthSessionFromRequest({
    req: params.req,
    trustedProxy: params.trustedProxy,
    localDirect: params.localDirect,
  });
  if (!platformSession) {
    return null;
  }
  return {
    ok: true,
    method: "trusted-proxy",
    user: platformSession.user,
    trustedProxy: platformSession,
  };
}

function shouldTryPlatformSessionBeforeSharedSecret(params: {
  authSurface: GatewayAuthSurface;
  trustedProxy: GatewayTrustedProxyConfig | undefined;
  connectAuth?: ConnectAuth | null;
}): boolean {
  if (!isPlatformBrowserAuthEnabled(params.trustedProxy)) {
    return false;
  }
  if (params.authSurface === "ws-control-ui") {
    return true;
  }
  if (params.authSurface === "http") {
    return !params.connectAuth?.token && !params.connectAuth?.password;
  }
  return false;
}

/**
 * Resolve the sanctioned loopback operator (`gateway.auth.trustedProxy.localOperator`)
 * to a trusted-proxy session. Opt-in and fail-closed: returns `null` unless the
 * feature is enabled AND the configured email maps to an active platform-auth
 * user with an enterprise membership. Callers MUST invoke this only for
 * direct-loopback requests (see `isLocalDirectRequest`) — it is never a
 * substitute for proxy/session auth on remote connections.
 */
async function resolveLoopbackOperatorSession(
  trustedProxy: GatewayTrustedProxyConfig | undefined,
): Promise<PlatformAuthTrustedProxySession | null> {
  const operator = trustedProxy?.localOperator;
  if (!operator?.enabled) {
    return null;
  }
  const config = resolvePlatformAuthConfig(trustedProxy);
  if (!config?.enabled) {
    return null;
  }
  try {
    const store = await loadPlatformAuthStore(config);
    return resolveOperatorSessionFromStore(store, operator.user);
  } catch {
    // Platform-auth store unavailable/unreadable → keep the anonymous principal.
    return null;
  }
}

export async function authorizeGatewayConnect(
  params: AuthorizeGatewayConnectParams,
): Promise<GatewayAuthResult> {
  const { auth, connectAuth, req, trustedProxies } = params;
  const tailscaleWhois = params.tailscaleWhois ?? readTailscaleWhoisIdentity;
  const authSurface = params.authSurface ?? "http";
  const allowTailscaleHeaderAuth = shouldAllowTailscaleHeaderAuth(authSurface);
  const localDirect = isLocalDirectRequest(
    req,
    trustedProxies,
    params.allowRealIpFallback === true,
  );

  if (auth.mode === "trusted-proxy") {
    if (!auth.trustedProxy) {
      return { ok: false, reason: "trusted_proxy_config_missing" };
    }
    if (!trustedProxies || trustedProxies.length === 0) {
      return { ok: false, reason: "trusted_proxy_no_proxies_configured" };
    }

    // Trusted-proxy WS/browser failures previously skipped the shared-secret
    // rate-limit path entirely. Mac cloud clients that omit the platform
    // session cookie then reconnect forever and stampede the gateway.
    const limiter = params.rateLimiter;
    const ip =
      params.clientIp ??
      resolveRequestClientIp(req, trustedProxies, params.allowRealIpFallback === true) ??
      req?.socket?.remoteAddress;
    const rateLimitScope = params.rateLimitScope ?? AUTH_RATE_LIMIT_SCOPE_SHARED_SECRET;
    if (limiter) {
      const rlCheck: RateLimitCheckResult = limiter.check(ip, rateLimitScope);
      if (!rlCheck.allowed) {
        return {
          ok: false,
          reason: "rate_limited",
          rateLimited: true,
          retryAfterMs: rlCheck.retryAfterMs,
        };
      }
    }

    const result = authorizeTrustedProxy({
      req,
      trustedProxies,
      trustedProxyConfig: auth.trustedProxy,
    });

    if ("session" in result) {
      limiter?.reset(ip, rateLimitScope);
      return {
        ok: true,
        method: "trusted-proxy",
        user: result.session.user,
        trustedProxy: result.session,
      };
    }
    const platformSessionAuth = await authorizePlatformSessionConnect({
      req,
      trustedProxy: auth.trustedProxy,
      localDirect,
    });
    if (platformSessionAuth) {
      limiter?.reset(ip, rateLimitScope);
      return platformSessionAuth;
    }
    // Loopback CLI / in-process agent tools connect to ws://127.0.0.1 and cannot
    // present nginx identity headers. Keep browser traffic on the proxy path, but
    // allow host-local operator calls when bind is loopback-only.
    if (localDirect) {
      // If a loopback token is configured, still require it (defense in depth)
      // before adopting any local identity.
      if (auth.token) {
        if (!connectAuth?.token) {
          return { ok: false, reason: "token_missing" };
        }
        if (!safeEqualSecret(connectAuth.token, auth.token)) {
          limiter?.recordFailure(ip, rateLimitScope);
          return { ok: false, reason: "token_mismatch" };
        }
      }
      // Sanctioned loopback operator (opt-in): adopt a configured platform
      // identity so the local Control UI resolves a real enterprise tenant
      // instead of an identity-less principal. Fails closed below when unset or
      // unresolvable. Strictly gated by localDirect — never for proxied traffic.
      const operatorSession = await resolveLoopbackOperatorSession(auth.trustedProxy);
      if (operatorSession) {
        limiter?.reset(ip, rateLimitScope);
        return {
          ok: true,
          method: "trusted-proxy",
          user: operatorSession.user,
          trustedProxy: operatorSession,
        };
      }
      if (auth.token) {
        limiter?.reset(ip, rateLimitScope);
        return { ok: true, method: "token" };
      }
      return { ok: true, method: "none", user: "local" };
    }
    // Missing platform session / identity headers are retryable only after the
    // client refreshes credentials — count them so runaway reconnects lock out.
    if (
      result.reason === "trusted_proxy_user_missing" ||
      result.reason === "trusted_proxy_user_not_allowed" ||
      result.reason === "trusted_proxy_untrusted_source" ||
      result.reason.startsWith("trusted_proxy_missing_header_")
    ) {
      limiter?.recordFailure(ip, rateLimitScope);
    }
    return { ok: false, reason: result.reason };
  }

  if (auth.mode === "none") {
    // Seam 1 (operational-identity-governance R2): identity attribution is
    // decoupled from auth.mode. A valid, HMAC-signed platform session is honored
    // even under auth.mode=none so the employee/enterprise identity is attached.
    // Without a valid session this falls through to the original anonymous result,
    // preserving non-regression for local single-operator mode (R7).
    if (req) {
      const platformSessionAuth = await authorizePlatformSessionConnect({
        req,
        trustedProxy: auth.trustedProxy,
        localDirect,
        requirePlatformAuthConfig: false,
      });
      if (platformSessionAuth) {
        return platformSessionAuth;
      }
    }
    return { ok: true, method: "none" };
  }

  const limiter = params.rateLimiter;
  const ip =
    params.clientIp ??
    resolveRequestClientIp(req, trustedProxies, params.allowRealIpFallback === true) ??
    req?.socket?.remoteAddress;
  const rateLimitScope = params.rateLimitScope ?? AUTH_RATE_LIMIT_SCOPE_SHARED_SECRET;
  if (limiter) {
    const rlCheck: RateLimitCheckResult = limiter.check(ip, rateLimitScope);
    if (!rlCheck.allowed) {
      return {
        ok: false,
        reason: "rate_limited",
        rateLimited: true,
        retryAfterMs: rlCheck.retryAfterMs,
      };
    }
  }

  if (allowTailscaleHeaderAuth && auth.allowTailscale && !localDirect) {
    const tailscaleCheck = await resolveVerifiedTailscaleUser({
      req,
      tailscaleWhois,
    });
    if (tailscaleCheck.ok) {
      limiter?.reset(ip, rateLimitScope);
      return {
        ok: true,
        method: "tailscale",
        user: tailscaleCheck.user.login,
      };
    }
  }

  if (auth.mode === "token") {
    if (
      shouldTryPlatformSessionBeforeSharedSecret({
        authSurface,
        trustedProxy: auth.trustedProxy,
        connectAuth,
      })
    ) {
      const platformSessionAuth = await authorizePlatformSessionConnect({
        req,
        trustedProxy: auth.trustedProxy,
        localDirect,
      });
      if (platformSessionAuth) {
        limiter?.reset(ip, rateLimitScope);
        return platformSessionAuth;
      }
    }
    if (!auth.token) {
      return { ok: false, reason: "token_missing_config" };
    }
    if (!connectAuth?.token) {
      // Don't burn rate-limit slots for missing credentials — the client
      // simply hasn't provided a token yet (e.g. bare browser open).
      // Only actual *wrong* credentials should count as failures.
      return { ok: false, reason: "token_missing" };
    }
    if (!safeEqualSecret(connectAuth.token, auth.token)) {
      limiter?.recordFailure(ip, rateLimitScope);
      return { ok: false, reason: "token_mismatch" };
    }
    limiter?.reset(ip, rateLimitScope);
    return { ok: true, method: "token" };
  }

  if (auth.mode === "password") {
    if (
      shouldTryPlatformSessionBeforeSharedSecret({
        authSurface,
        trustedProxy: auth.trustedProxy,
        connectAuth,
      })
    ) {
      const platformSessionAuth = await authorizePlatformSessionConnect({
        req,
        trustedProxy: auth.trustedProxy,
        localDirect,
      });
      if (platformSessionAuth) {
        limiter?.reset(ip, rateLimitScope);
        return platformSessionAuth;
      }
    }
    const password = connectAuth?.password;
    if (!auth.password) {
      return { ok: false, reason: "password_missing_config" };
    }
    if (!password) {
      // Same as token_missing — don't penalize absent credentials.
      return { ok: false, reason: "password_missing" };
    }
    if (!safeEqualSecret(password, auth.password)) {
      limiter?.recordFailure(ip, rateLimitScope);
      return { ok: false, reason: "password_mismatch" };
    }
    limiter?.reset(ip, rateLimitScope);
    return { ok: true, method: "password" };
  }

  limiter?.recordFailure(ip, rateLimitScope);
  return { ok: false, reason: "unauthorized" };
}

export async function authorizeHttpGatewayConnect(
  params: Omit<AuthorizeGatewayConnectParams, "authSurface">,
): Promise<GatewayAuthResult> {
  return authorizeGatewayConnect({
    ...params,
    authSurface: "http",
  });
}

export async function authorizeWsControlUiGatewayConnect(
  params: Omit<AuthorizeGatewayConnectParams, "authSurface">,
): Promise<GatewayAuthResult> {
  return authorizeGatewayConnect({
    ...params,
    authSurface: "ws-control-ui",
  });
}
