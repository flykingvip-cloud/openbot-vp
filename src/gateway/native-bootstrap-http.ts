/**
 * Tri-Platform Employee Shell — `/native/bootstrap` HTTP endpoints (Phase 1).
 *
 * Two token-gated routes that move an authenticated employee identity into a
 * native app's embedded WebView cookie jar WITHOUT hand-injecting cookies
 * (design doc §5.4):
 *
 *   POST /native/bootstrap/mint?target=/embed/employee/<surface>|/
 *     Auth: the caller's EXISTING platform-auth session cookie. Because the
 *     session cookie is SameSite=Lax, a cross-site POST cannot carry it, so this
 *     is CSRF-safe. Mints a single-use, <=60s token bound to that user + a
 *     server-validated embed target, and returns it as JSON (readable only
 *     same-origin). Native-login follow-up: the mint principal will later come
 *     from the native Employee Identity instead of a pre-existing web session.
 *
 *   GET /native/bootstrap?token=...&target=...
 *     Consumes the one-time token, establishes an HttpOnly employee session
 *     cookie (the SAME signed-cookie path as web login), then 302-redirects to
 *     the re-validated embed target. Invalid/expired/used token -> 401 (the
 *     WebView then re-bootstraps). The token rides in the URL but is single-use +
 *     short-lived, and Referrer-Policy: no-referrer (set globally by
 *     setDefaultSecurityHeaders) prevents it leaking via the Referer header.
 *
 * The session established is always the EMPLOYEE surface (resolveSessionContext
 * intent "employee"): no role elevation, domain = "employee", which is what the
 * workbench.* read-models expect.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig } from "../config/config.js";
import type { GatewayTrustedProxyConfig } from "../config/types.gateway.js";
import {
  createBootstrapTokenStore,
  type BootstrapTokenStore,
} from "./employee-shell/bootstrap-token-store.js";
import {
  isSafeNativeBootstrapTarget,
  safeNativeBootstrapTargetOrDefault,
} from "./employee-shell/embed-target.js";
import {
  sendInvalidRequest,
  sendJson,
  sendMethodNotAllowed,
  sendText,
  sendUnauthorized,
} from "./http-common.js";
import {
  establishPlatformSessionCookie,
  resolveSessionContext,
} from "./platform-auth/auth-helpers.js";
import {
  resolvePlatformAuthConfig,
  type ResolvedPlatformAuthConfig,
} from "./platform-auth/config.js";
import { resolveSessionMembershipBinding } from "./platform-auth/memberships.js";
import { readPlatformAuthSessionContextFromRequest } from "./platform-auth/session-context.js";
import type { PlatformAuthSessionContext, PlatformAuthStore } from "./platform-auth/store-types.js";
import { loadStore } from "./platform-auth/store.js";

export const NATIVE_BOOTSTRAP_PATH = "/native/bootstrap";
export const NATIVE_BOOTSTRAP_MINT_PATH = "/native/bootstrap/mint";

/** Injectable dependencies; defaults wire the real platform-auth machinery. */
export type NativeBootstrapHttpDeps = {
  /** Resolve platform-auth config, or null when platform-auth is not configured. */
  resolvePlatformAuthConfig: () => ResolvedPlatformAuthConfig | null;
  loadStore: (config: ResolvedPlatformAuthConfig) => Promise<PlatformAuthStore>;
  /** Read the caller's authenticated platform-auth session (mint auth), or null. */
  readSessionContext: (req: IncomingMessage) => Promise<PlatformAuthSessionContext | null>;
  /** Build an EMPLOYEE-surface session from an exact membership binding, or null when it is invalid. */
  resolveEmployeeSessionContext: (
    store: PlatformAuthStore,
    userId: string,
    membershipId: string,
    enterpriseId: string,
  ) => PlatformAuthSessionContext | null;
  establishSessionCookie: (params: {
    req: IncomingMessage;
    res: ServerResponse;
    config: ResolvedPlatformAuthConfig;
    store: PlatformAuthStore;
    context: PlatformAuthSessionContext;
  }) => Promise<unknown>;
  tokenStore: BootstrapTokenStore;
};

function trustedProxyConfig(): GatewayTrustedProxyConfig | undefined {
  return loadConfig().gateway?.auth?.trustedProxy;
}

function defaultDeps(): NativeBootstrapHttpDeps {
  return {
    resolvePlatformAuthConfig: () => resolvePlatformAuthConfig(trustedProxyConfig()) ?? null,
    loadStore: (config) => loadStore(config),
    readSessionContext: (req) =>
      readPlatformAuthSessionContextFromRequest({ req, trustedProxy: trustedProxyConfig() }),
    resolveEmployeeSessionContext: (store, userId, membershipId, enterpriseId) => {
      const user = store.users[userId];
      const membership = resolveSessionMembershipBinding({
        store,
        userId,
        membershipId,
        enterpriseId,
      });
      return user && membership ? resolveSessionContext(store, user, "employee", membership) : null;
    },
    establishSessionCookie: (params) => establishPlatformSessionCookie(params),
    tokenStore: createBootstrapTokenStore(),
  };
}

/** Build the `/native/bootstrap?token=...&target=...` path the WebView opens. */
export function buildBootstrapPath(token: string, target: string): string {
  const params = new URLSearchParams({ token, target });
  return `${NATIVE_BOOTSTRAP_PATH}?${params.toString()}`;
}

async function handleMint(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: NativeBootstrapHttpDeps,
): Promise<void> {
  const config = deps.resolvePlatformAuthConfig();
  if (!config) {
    sendUnauthorized(res);
    return;
  }
  // Mint requires an already-authenticated platform-auth session (its cookie).
  const context = await deps.readSessionContext(req);
  if (
    !context?.membership ||
    !context.enterprise ||
    context.membership.userId !== context.user.id ||
    context.membership.enterpriseId !== context.enterprise.id
  ) {
    // A platform session has no tenant authority. It must re-establish an
    // explicit enterprise/employee session before bootstrapping a WebView.
    sendUnauthorized(res);
    return;
  }
  const target = safeNativeBootstrapTargetOrDefault(url.searchParams.get("target"));
  const token = deps.tokenStore.mint({
    userId: context.user.id,
    userEmail: context.user.email,
    membershipId: context.membership.id,
    enterpriseId: context.enterprise.id,
    target,
  });
  sendJson(res, 200, { ok: true, token, target, bootstrapPath: buildBootstrapPath(token, target) });
}

async function handleConsume(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: NativeBootstrapHttpDeps,
): Promise<void> {
  const token = url.searchParams.get("token");
  if (!token) {
    sendInvalidRequest(res, "missing bootstrap token");
    return;
  }
  const principal = deps.tokenStore.consume(token);
  if (!principal) {
    // Invalid / expired / already used -> the WebView silently re-bootstraps.
    sendUnauthorized(res);
    return;
  }
  const config = deps.resolvePlatformAuthConfig();
  if (!config) {
    sendUnauthorized(res);
    return;
  }
  const store = await deps.loadStore(config);
  const context = deps.resolveEmployeeSessionContext(
    store,
    principal.userId,
    principal.membershipId,
    principal.enterpriseId,
  );
  if (!context) {
    // The bound user no longer exists.
    sendUnauthorized(res);
    return;
  }
  await deps.establishSessionCookie({ req, res, config, store, context });
  // Re-validate the redirect target server-side (never trust the URL). Prefer a
  // safe URL target; otherwise fall back to the target captured (and validated)
  // at mint time, which is always safe.
  const urlTarget = url.searchParams.get("target");
  const target = isSafeNativeBootstrapTarget(urlTarget)
    ? urlTarget
    : safeNativeBootstrapTargetOrDefault(principal.target);
  res.statusCode = 302;
  res.setHeader("Location", target);
  res.end();
}

/**
 * Create the `/native/bootstrap` request handler. Owns a single in-memory token
 * store shared between the mint and consume routes. Returns a stage handler:
 * resolves to true when it handled the request, false to fall through.
 */
export function createNativeBootstrapHttpHandler(
  overrides?: Partial<NativeBootstrapHttpDeps>,
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const deps: NativeBootstrapHttpDeps = { ...defaultDeps(), ...overrides };
  return async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === NATIVE_BOOTSTRAP_MINT_PATH) {
      if (req.method !== "POST") {
        sendMethodNotAllowed(res, "POST");
        return true;
      }
      try {
        await handleMint(req, res, url, deps);
      } catch {
        if (!res.headersSent) {
          sendText(res, 500, "bootstrap mint failed");
        }
      }
      return true;
    }
    if (url.pathname === NATIVE_BOOTSTRAP_PATH) {
      if (req.method !== "GET") {
        sendMethodNotAllowed(res, "GET");
        return true;
      }
      try {
        await handleConsume(req, res, url, deps);
      } catch {
        if (!res.headersSent) {
          sendText(res, 500, "bootstrap failed");
        }
      }
      return true;
    }
    return false;
  };
}
