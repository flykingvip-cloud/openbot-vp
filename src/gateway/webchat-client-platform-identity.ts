import type { IncomingMessage } from "node:http";
import { loadConfig, type GatewayTrustedProxyConfig } from "../config/config.js";
import { getPairedDevice } from "../infra/device-pairing.js";
import { isWebchatClient } from "../utils/message-channel.js";
import { readPlatformAuthSessionFromRequest } from "./platform-auth.js";
import { resolveClientSessionIdentity } from "./platform-auth/active-membership-client-context.js";
import { resolveAuthoritativeEnterpriseScopeForClient } from "./platform-auth/active-membership-scope.js";
import { resolvePlatformAuthConfig } from "./platform-auth/config.js";
import {
  findUserByEmail,
  findUserById,
  resolvePreferredMembershipForUser,
} from "./platform-auth/memberships.js";
import { normalizeEmail } from "./platform-auth/request-helpers.js";
import { loadStore } from "./platform-auth/store.js";
import { resolveRequestSessionSurface } from "./platform-auth/target-surface.js";
import { isGatewayControlUiClientId } from "./protocol/client-info.js";
import type { GatewayClient } from "./server-methods/types.js";
import { canonicalizeTenantId } from "./tenant-canonicalization.js";

/** Cookie + locality captured from the WS upgrade request for later identity refresh. */
export type WebchatUpgradeIdentityBinding = {
  upgradeRequestCookie?: string;
  upgradeRequestLocalDirect?: boolean;
  upgradeRequestOrigin?: string;
  upgradeRequestHost?: string;
};

export function isWebchatOrControlUiClient(client: GatewayClient | null | undefined): boolean {
  const info = client?.connect?.client;
  if (!info) {
    return false;
  }
  return isWebchatClient(info) || isGatewayControlUiClientId(info.id);
}

export function extractUpgradeRequestCookieHeader(
  req: Pick<IncomingMessage, "headers"> | null | undefined,
): string | undefined {
  const raw = req?.headers?.cookie;
  if (Array.isArray(raw)) {
    const joined = raw
      .map((entry) => entry.trim())
      .filter(Boolean)
      .join("; ");
    return joined || undefined;
  }
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed || undefined;
}

function buildSyntheticCookieRequest(
  cookieHeader: string,
  client?: Pick<GatewayClient, "upgradeRequestOrigin" | "upgradeRequestHost">,
): IncomingMessage {
  const headers: Record<string, string> = { cookie: cookieHeader };
  const origin = client?.upgradeRequestOrigin?.trim();
  const host = client?.upgradeRequestHost?.trim();
  if (origin) {
    headers.origin = origin;
  }
  if (host) {
    headers.host = host;
  }
  return { headers } as IncomingMessage;
}

function hasAuthoritativeMembershipPair(client: GatewayClient): boolean {
  return Boolean(client.sessionMembershipId?.trim() && client.sessionEnterpriseId?.trim());
}

function identityNeedsHydration(client: GatewayClient): boolean {
  if (!client.user?.trim() || !client.sessionDomain) {
    return true;
  }
  if (
    (client.sessionDomain === "employee" || client.sessionDomain === "enterprise") &&
    (!client.platformUserId?.trim() || !hasAuthoritativeMembershipPair(client))
  ) {
    return true;
  }
  return false;
}

/**
 * Prefer a cookie-backed platform session (has user) over a partial trusted-proxy
 * session so webchat/control-ui connections never skip personal identity when the
 * browser cookie is present on the upgrade request.
 */
export function preferPlatformSessionWithUser<T extends { user?: string | null }>(params: {
  primary?: T | null;
  fallback?: T | null;
}): T | null {
  const primaryUser = params.primary?.user?.trim();
  if (primaryUser) {
    return params.primary ?? null;
  }
  const fallbackUser = params.fallback?.user?.trim();
  if (fallbackUser) {
    return params.fallback ?? null;
  }
  return params.primary ?? params.fallback ?? null;
}

function resolvePairedDeviceId(client: GatewayClient): string | undefined {
  return (
    client.pairedDeviceId?.trim() ||
    client.connect?.device?.id?.trim() ||
    client.connect?.client?.instanceId?.trim() ||
    undefined
  );
}

/**
 * Device-token workbench connects often have neither cookie nor client.user.
 * The paired device already carries the approving user's platform-auth id
 * (per device, so different users keep their own mailbox bindings).
 */
export async function fillPlatformUserIdFromPairedDevice(client: GatewayClient): Promise<void> {
  if (client.platformUserId?.trim()) {
    return;
  }
  const deviceId = resolvePairedDeviceId(client);
  if (!deviceId) {
    return;
  }
  try {
    const ownerId = (await getPairedDevice(deviceId))?.ownerId?.trim();
    if (ownerId) {
      client.platformUserId = ownerId;
    }
  } catch {
    // Best-effort: settings RPCs can still resolve owner via attribution.
  }
}

async function fillClientUserFromPlatformUserId(
  client: GatewayClient,
  trustedProxy?: GatewayTrustedProxyConfig,
): Promise<void> {
  if (client.user?.trim() || !client.platformUserId?.trim()) {
    return;
  }
  try {
    const config = resolvePlatformAuthConfig(
      trustedProxy ?? loadConfig().gateway?.auth?.trustedProxy,
    );
    if (!config) {
      return;
    }
    const store = await loadStore(config);
    const user = findUserById(store, client.platformUserId);
    const email = user?.email?.trim() || user?.normalizedEmail?.trim();
    if (email) {
      client.user = email;
    }
  } catch {
    // Best-effort: settings RPCs can resolve owner from platformUserId alone.
  }
}

/**
 * Device-token workbench connections may have platformUserId without client.user.
 * Fill the email so chat.send can pass GatewayClientUser into steward tools.
 */
/**
 * Backfill the authoritative membership pair (+ operational domain) on
 * workbench clients. Header-only trusted-proxy connects often carry `user`
 * without `sessionDomain` / membership ids (nginx strips tenant headers on
 * cookie-native apex). A tenant id alone is a half-bound context and makes
 * `agents.create` fail as `NO_AUTHORITATIVE_TENANT`; both sides are written
 * together or not at all.
 */
export async function ensureGatewayClientEnterpriseTenant(
  client: GatewayClient | null | undefined,
): Promise<void> {
  if (!client) {
    return;
  }
  // Explicit platform control-plane sessions must stay unbound (R1.3).
  if (client.sessionDomain === "platform") {
    return;
  }
  const hasPair = hasAuthoritativeMembershipPair(client);
  // Only fill a *missing* domain. Never clobber an explicit `platform` domain
  // (control-plane R1.3). Domain-less header/cookie-gap connects still get an
  // operational domain so chat cwd / trusted locators are not false-closed.
  const needsDomain = !client.sessionDomain;
  if (hasPair && !needsDomain) {
    return;
  }
  const hasIdentity = Boolean(client.platformUserId?.trim() || client.user?.trim());
  if (!hasIdentity) {
    return;
  }
  try {
    const config = resolvePlatformAuthConfig(loadConfig().gateway?.auth?.trustedProxy);
    if (!config?.enabled) {
      return;
    }
    const store = await loadStore(config);
    // A lone sessionEnterpriseId is not a pin. Resolving with it would deny
    // as membership-unknown and block the unique-membership pair we can still
    // attach. Ambiguous multi-tenant users stay unbound (fail closed).
    let email = client.user?.trim() || "";
    if (!email && client.platformUserId?.trim()) {
      const user = findUserById(store, client.platformUserId);
      email = user?.email?.trim() || user?.normalizedEmail?.trim() || "";
      if (email) {
        client.user = email;
      }
    }
    const scope = resolveAuthoritativeEnterpriseScopeForClient({
      store,
      client: hasPair ? client : { user: email },
      canonicalize: canonicalizeTenantId,
    });
    if (scope.kind !== "authoritative") {
      return;
    }
    if (!hasPair) {
      client.sessionMembershipId = scope.membership.id;
      client.sessionEnterpriseId = scope.enterpriseId;
      client.sessionTenantId = scope.enterpriseId;
    } else if (!client.sessionTenantId?.trim()) {
      client.sessionTenantId = scope.enterpriseId;
    }
    if (needsDomain) {
      // Dual-role / domain-less chat: enterprise store is the canonical BYOK scope
      // (same inference as resolveTenantContextForSessionStore).
      client.sessionDomain = "enterprise";
    }
  } catch {
    // Best-effort: directory APIs will still fail closed without tenant.
  }
}

export async function ensureGatewayClientUserFromPlatformIdentity(params: {
  client: GatewayClient | null;
  trustedProxy?: GatewayTrustedProxyConfig;
}): Promise<GatewayClient | null> {
  const client = params.client;
  if (!client) {
    return client;
  }
  await fillPlatformUserIdFromPairedDevice(client);
  await fillClientUserFromPlatformUserId(client, params.trustedProxy);
  await ensureGatewayClientEnterpriseTenant(client);
  return client;
}

function connectPagePath(client: GatewayClient): string | undefined {
  const raw = (client.connect as { pagePath?: unknown } | undefined)?.pagePath;
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

function clearPinnedMembership(client: GatewayClient): void {
  delete client.sessionMembershipId;
  delete client.sessionEnterpriseId;
  delete client.sessionTenantId;
}

/**
 * Personal workbench hosts must not keep a platform-ranked session.
 *
 * `www` / `gw` become an employee session. A CEO who only holds an
 * enterprise-admin membership is still bound to that seat. Leaving the
 * socket as `platform`, or stripping it to an anonymous client, made
 * `agents.list` return the install roster. `biz` binds an enterprise-admin
 * membership when one exists.
 * The platform console is left alone. An unknown host is not guessed.
 * When the person cannot be bound, the personal surface is still pinned so
 * the roster fails closed to the steward.
 */
async function projectPersonalWorkbenchIdentity(
  client: GatewayClient,
  trustedProxy?: GatewayTrustedProxyConfig,
): Promise<void> {
  const resolution = resolveRequestSessionSurface({
    origin: client.upgradeRequestOrigin,
    host: client.upgradeRequestHost,
    pathname: connectPagePath(client),
  });
  if (resolution.kind !== "authoritative") {
    return;
  }
  if (resolution.surface === "platform") {
    if (client.sessionDomain && client.sessionDomain !== "platform") {
      delete client.user;
      delete client.platformUserId;
      delete client.sessionDomain;
      delete client.sessionKind;
      clearPinnedMembership(client);
    }
    return;
  }
  const surface = resolution.surface;
  const alreadyBound =
    client.sessionDomain === surface &&
    Boolean(client.user?.trim()) &&
    Boolean(client.sessionMembershipId?.trim()) &&
    Boolean(client.sessionEnterpriseId?.trim());
  if (alreadyBound) {
    return;
  }

  const pinUnboundSurface = () => {
    client.sessionDomain = surface;
    // No seat and no admin grant. Platform rank must not survive on this host.
    client.sessionKind = "member";
  };
  if (!client.user?.trim() && !client.platformUserId?.trim()) {
    pinUnboundSurface();
    return;
  }

  try {
    const config = resolvePlatformAuthConfig(
      trustedProxy ?? loadConfig().gateway?.auth?.trustedProxy,
    );
    if (!config?.enabled) {
      pinUnboundSurface();
      clearPinnedMembership(client);
      return;
    }
    const store = await loadStore(config);
    const email = client.user?.trim();
    const user =
      (email ? findUserByEmail(store, normalizeEmail(email)) : undefined) ??
      (client.platformUserId?.trim() ? findUserById(store, client.platformUserId) : undefined);
    if (!user || user.status !== "active") {
      pinUnboundSurface();
      clearPinnedMembership(client);
      return;
    }
    const membership =
      surface === "enterprise"
        ? resolvePreferredMembershipForUser({
            store,
            userId: user.id,
            membershipId: client.sessionMembershipId,
            enterpriseId: client.sessionEnterpriseId,
            intent: "enterprise-admin",
            requiredRole: "enterprise-admin",
          })
        : (resolvePreferredMembershipForUser({
            store,
            userId: user.id,
            intent: "employee",
            requiredRole: "member",
          }) ??
          resolvePreferredMembershipForUser({
            store,
            userId: user.id,
            enterpriseId: client.sessionEnterpriseId,
          }) ??
          resolvePreferredMembershipForUser({
            store,
            userId: user.id,
          }));
    client.user = user.email;
    client.platformUserId = user.id;
    client.sessionDomain = surface;
    if (surface === "enterprise" && membership?.membershipRole === "enterprise-admin") {
      client.sessionKind = "enterprise-admin";
    } else {
      client.sessionKind = "member";
    }
    if (membership) {
      client.sessionMembershipId = membership.id;
      client.sessionEnterpriseId = membership.enterpriseId;
      client.sessionTenantId = membership.enterpriseId;
      return;
    }
    clearPinnedMembership(client);
  } catch {
    pinUnboundSurface();
    clearPinnedMembership(client);
  }
}

/**
 * Re-read the platform session from the WS upgrade cookie and mutate `client`
 * in place when the session carries a user. An authoritative personal host
 * (`www` / `gw` / `biz`) then projects that identity onto the employee or
 * enterprise surface. The platform console is not rewritten. Safe no-op for
 * non-webchat clients.
 */
export async function hydrateWebchatGatewayClientPlatformIdentity(params: {
  client: GatewayClient | null;
  trustedProxy?: GatewayTrustedProxyConfig;
  /** Force a cookie re-read even when client.user is already set. */
  force?: boolean;
}): Promise<GatewayClient | null> {
  const client = params.client;
  if (!client || !isWebchatOrControlUiClient(client)) {
    await ensureGatewayClientUserFromPlatformIdentity(params);
    return client;
  }
  if (!params.force && !identityNeedsHydration(client)) {
    await projectPersonalWorkbenchIdentity(client, params.trustedProxy);
    await ensureGatewayClientEnterpriseTenant(client);
    return client;
  }
  const cookieHeader = client.upgradeRequestCookie?.trim();
  const trustedProxy = params.trustedProxy ?? loadConfig().gateway?.auth?.trustedProxy ?? undefined;
  if (cookieHeader) {
    const session = await readPlatformAuthSessionFromRequest({
      req: buildSyntheticCookieRequest(cookieHeader, client),
      trustedProxy,
      localDirect: client.upgradeRequestLocalDirect === true,
    });
    if (session?.user?.trim()) {
      Object.assign(client, resolveClientSessionIdentity(session));
      if (!client.platformUserId?.trim() && session.user?.trim()) {
        try {
          const config = resolvePlatformAuthConfig(
            trustedProxy ?? loadConfig().gateway?.auth?.trustedProxy,
          );
          if (config) {
            const store = await loadStore(config);
            const user = findUserByEmail(store, normalizeEmail(session.user));
            if (user?.id) {
              client.platformUserId = user.id;
            }
          }
        } catch {
          // Best-effort enrichment for steward chat isolation.
        }
      }
    }
  }
  await fillPlatformUserIdFromPairedDevice(client);
  await fillClientUserFromPlatformUserId(client, trustedProxy);
  await projectPersonalWorkbenchIdentity(client, trustedProxy);
  await ensureGatewayClientEnterpriseTenant(client);
  return client;
}
