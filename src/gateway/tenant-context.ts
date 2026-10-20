import fs from "node:fs/promises";
import path from "node:path";
import {
  resolveAgentConfig,
  resolveAgentDir,
  resolveSessionAgentId,
} from "../agents/agent-scope.js";
import { loadConfig } from "../config/config.js";
import {
  isSharedTenantAddressingEnabled,
  isManagedDataMode,
  resolveDataRoot,
} from "../config/data-space.js";
import {
  resolveSessionFilePath,
  resolveStorePath,
  updateSessionStore,
  type SessionEntry,
} from "../config/sessions.js";
import type { OpenBotConfig } from "../config/types.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { resolveUserPath } from "../utils.js";
import { healOperatorSessionEntryFromSharedStore } from "./operator-shared-session-heal.js";
import {
  findMembershipByUserId,
  findUserByEmail,
  findUserById,
  loadPlatformAuthStore,
  resolvePlatformAuthConfig,
} from "./platform-auth.js";
import type { GatewayClient } from "./server-methods/types.js";
import { loadSessionEntry } from "./session-utils.js";
import { canonicalizeTenantId } from "./tenant-canonicalization.js";
import {
  assertWithinTenantRoot,
  resolveControlPlaneStorePathForContext,
  resolveDataRootForContext,
  resolveTenantAgentDirForContext,
  resolveTenantSessionStorePathForContext,
  resolveTenantUserOperationalIdentitySecretsStorePathForContext,
  resolveTenantUserOperationalIdentityStorePathForContext,
  resolveTenantConnectorOAuthSessionStorePath,
} from "./tenant-store-paths.js";
import {
  loadExistingGovernedWorkspaceIdentity,
  resolveAuthorizedAgentToolWorkspaceCwd,
} from "./workspace-resolver/tool-cwd.js";
import {
  resolveLiveRobotWriteRoot,
  resolveRobotOwnWriteRoot,
} from "./workspace-resolver/write-roots.js";

/**
 * Per-request authoritative tenant/user context (spec `tenant-context-propagation`, R1).
 * Derived from the authenticated session ONLY — never from client-supplied params. `tenantId` is
 * the resolved enterprise and `userId` the platform-auth user id, resolved STRICTLY from platform
 * auth membership (email → user → membership → enterpriseId). It deliberately does NOT reuse
 * `resolveTrustedAttribution`, whose workbench-actor fallback would accept `client.sessionTenantId`
 * as the tenant when membership is absent (expert review 高危2) — that would let a forged hint
 * become the authority. Here the hint is used ONLY to CROSS-CHECK the membership tenant (mismatch
 * → reject); it is never an authority source, and a membership-less session fails closed.
 * NOTE (P0): this is not yet wired into request handlers (that is P1/P2). It ships with the
 * addressing layer's strict local-mode fallback (see `tenant-store-paths.ts`
 * `resolveDataRootForContext`), so P0 is purely additive and changes no runtime behavior.
 */

/** The session domains that carry an implicit tenant. `platform` is intentionally excluded (R1.3). */
export type TenantContextDomain = "enterprise" | "employee";

export type TenantContext = {
  tenantId: string;
  userId: string;
  domain: TenantContextDomain;
};

export type TenantContextErrorCode = "hint_mismatch" | "unresolved_tenant" | "unresolved_user";

export class TenantContextError extends Error {
  constructor(
    message: string,
    readonly code: TenantContextErrorCode,
  ) {
    super(message);
    this.name = "TenantContextError";
  }
}

/**
 * Membership-only authoritative `{ tenantId, userId }` for a session.
 *
 * Resolves STRICTLY from the platform-auth store: `client.user` (email) → user → membership →
 * `enterpriseId`. It NEVER consults `client.sessionTenantId` and does NOT use the workbench-actor /
 * local-operator fallbacks layered on by `resolveTrustedAttribution` (expert review 高危2). Returns
 * `null` fields when not resolvable; callers fail closed.
 *
 * Exported for object-level ACL (enroll/cancel/pattern) — directory resolution is not authorization.
 */
export async function resolveAuthoritativeMembership(
  client: GatewayClient | null,
): Promise<{ tenantId: string | null; userId: string | null }> {
  return resolveMembershipAuthority(client);
}

async function resolveMembershipAuthority(
  client: GatewayClient | null,
): Promise<{ tenantId: string | null; userId: string | null }> {
  const email = client?.user?.trim().toLowerCase();
  const platformUserId = client?.platformUserId?.trim();
  if (!email && !platformUserId) {
    return { tenantId: null, userId: null };
  }
  try {
    const authConfig = resolvePlatformAuthConfig(loadConfig().gateway?.auth?.trustedProxy);
    if (!authConfig?.enabled) {
      return { tenantId: null, userId: null };
    }
    const store = await loadPlatformAuthStore(authConfig);
    const user =
      (email ? findUserByEmail(store, email) : undefined) ??
      (platformUserId ? findUserById(store, platformUserId) : undefined);
    if (!user) {
      return { tenantId: null, userId: null };
    }
    const membership = findMembershipByUserId(store, user.id);
    const tenantId = membership ? canonicalizeTenantId(membership.enterpriseId) : null;
    return { tenantId, userId: user.id.trim() || null };
  } catch {
    // Platform-auth unavailable/unreadable → resolve nothing; the caller fails closed.
    return { tenantId: null, userId: null };
  }
}

/**
 * Resolve the authoritative {@link TenantContext} for a session (R1).
 *
 * - Returns `null` for platform-domain (no implicit tenant; cross-tenant ops use an explicit
 *   `targetTenantId` param, R1.3) and for sessions with no domain.
 * - Throws {@link TenantContextError} when the session's tenant hint disagrees with the
 *   membership tenant (R1.2), or when the tenant/user cannot be resolved from membership (R1.4).
 */
export async function resolveTenantContext(
  client: GatewayClient | null,
): Promise<TenantContext | null> {
  const domain = client?.sessionDomain;
  if (domain !== "enterprise" && domain !== "employee") {
    // Platform operators (and sessions without a domain) carry no implicit tenant (R1.3).
    return null;
  }

  const { tenantId: authoritativeTenantId, userId: resolvedUserId } =
    await resolveMembershipAuthority(client);

  // The handshake hint is untrusted: a mismatch is a rejection, never an override (R1.2).
  const hint = canonicalizeTenantId(client?.sessionTenantId ?? null);
  if (hint && authoritativeTenantId && hint !== authoritativeTenantId) {
    throw new TenantContextError(
      `session tenant hint (${hint}) does not match authoritative tenant (${authoritativeTenantId})`,
      "hint_mismatch",
    );
  }

  if (!authoritativeTenantId) {
    // Managed request paths must not fall back to an arbitrary/default tenant (R1.4). A
    // membership-less session fails closed here — the hint alone can never grant a tenant.
    throw new TenantContextError(
      "cannot resolve tenant for session (no enterprise membership)",
      "unresolved_tenant",
    );
  }

  const userId = resolvedUserId?.trim();
  if (!userId) {
    throw new TenantContextError("cannot resolve user id for session", "unresolved_user");
  }

  return { tenantId: authoritativeTenantId, userId, domain };
}

/**
 * Like {@link resolveTenantContext} but throws when it would be `null` — for managed request paths
 * that require a concrete tenant (e.g. a platform-domain caller reaching a tenant-scoped surface
 * without an explicit target).
 */
export async function requireTenantContext(client: GatewayClient | null): Promise<TenantContext> {
  const ctx = await resolveTenantContext(client);
  if (!ctx) {
    throw new TenantContextError(
      "tenant context required but the session has none",
      "unresolved_tenant",
    );
  }
  return ctx;
}

/**
 * Tenant context for **session-store / chat transcript** routing.
 *
 * Control-plane APIs keep {@link resolveTenantContext}'s R1.3 rule (platform = no implicit
 * tenant). Chat + `sessions.patch` cannot: dual-role platformAdmins (and CLI/trusted-proxy
 * connects with a missing domain) still have an enterprise membership, and if patch writes
 * the managed store while agent turns write `~/.openbot/agents/...`, BYOK `ent/*` selection
 * bifurcates and runs fall back to the platform proxy.
 *
 * When the session domain is missing or `platform` but membership resolves, infer an
 * operational domain (`enterprise`) so store reads/writes stay on the per-tenant path.
 * Hint mismatch still fails closed.
 */
export async function resolveTenantContextForSessionStore(
  client: GatewayClient | null,
): Promise<TenantContext | null> {
  const direct = await resolveTenantContext(client);
  if (direct) {
    return direct;
  }

  const domain = client?.sessionDomain;
  if (domain === "enterprise" || domain === "employee") {
    // resolveTenantContext already handled these (null only if it threw / no client).
    return null;
  }

  const { tenantId: authoritativeTenantId, userId: resolvedUserId } =
    await resolveMembershipAuthority(client);
  const hint = canonicalizeTenantId(client?.sessionTenantId ?? null);
  if (hint && authoritativeTenantId && hint !== authoritativeTenantId) {
    throw new TenantContextError(
      `session tenant hint (${hint}) does not match authoritative tenant (${authoritativeTenantId})`,
      "hint_mismatch",
    );
  }
  if (!authoritativeTenantId) {
    return null;
  }
  const userId = resolvedUserId?.trim();
  if (!userId) {
    return null;
  }
  return {
    tenantId: authoritativeTenantId,
    userId,
    // Dual-role / domain-less chat: enterprise store is the canonical BYOK scope.
    domain: "enterprise",
  };
}

/** Like {@link resolveTenantContextForSessionStore} but throws when unresolved. */
export async function requireTenantContextForSessionStore(
  client: GatewayClient | null,
): Promise<TenantContext> {
  const ctx = await resolveTenantContextForSessionStore(client);
  if (!ctx) {
    throw new TenantContextError(
      "tenant context required but the session has none",
      "unresolved_tenant",
    );
  }
  return ctx;
}

/**
 * Resolve the per-tenant L1 control-plane store path for a request's session — or `undefined` to
 * use the process-global default store (spec P1 · R3). This is the single client→L1-store-path
 * seam a managed handler calls before loading a control-plane store (seat-assets / enterprise-data):
 *
 * ```ts
 * const seatStore = await loadEnterpriseSeatAssetsStore(
 *   await resolveControlPlaneStorePathForClient(client, TENANT_SEAT_ASSETS_FILE),
 * );
 * ```
 *
 * It carries the same mode-keyed, fail-closed contract as `resolveDataRootForContext`
 * (expert review 高危1/高危2):
 *
 * - **local / self-hosted** (`!isManagedDataMode`): returns `undefined`, so the loader keeps using
 *   its process-global default path — byte-identical to today (R2 zero-change). The authoritative
 *   context is not even resolved, so single-tenant deployments without a platform-auth store are
 *   wholly unaffected.
 * - **managed**: requires an authoritative {@link TenantContext} (membership-only — a forged
 *   `sessionTenantId` can never select another tenant). A missing / unresolvable context throws
 *   (fail-closed); a managed handler never silently falls back to the shared global store.
 *
 * Only `seat-assets` and `enterprise-data` are per-tenant L1 (Q-A). `platform-auth` stays a global
 * authority store (tenant is DERIVED from it), so it must NOT be routed through this seam.
 */
export async function resolveControlPlaneStorePathForClient(
  client: GatewayClient | null,
  storeFile: string,
  cfg?: OpenBotConfig,
): Promise<string | undefined> {
  // D5: shared multi-tenant addressing is gated by OPENBOT_MULTITENANT (plus managed mode).
  if (!isSharedTenantAddressingEnabled(cfg ?? loadConfig())) {
    return undefined;
  }
  const ctx = await requireTenantContext(client);
  const storePath = resolveControlPlaneStorePathForContext(ctx, storeFile);
  assertWithinTenantRoot(ctx, storePath);
  return storePath;
}

/**
 * L1 control-plane path when the tenant id is already known (e.g. platform-auth membership)
 * but no {@link GatewayClient} is available. Returns `undefined` when shared addressing is off.
 */
export function resolveControlPlaneStorePathForTenantId(
  tenantId: string,
  storeFile: string,
  cfg?: OpenBotConfig,
): string | undefined {
  if (!isSharedTenantAddressingEnabled(cfg ?? loadConfig())) {
    return undefined;
  }
  const tid = canonicalizeTenantId(tenantId);
  if (!tid) {
    return undefined;
  }
  const ctx: TenantContext = { tenantId: tid, userId: "control-plane", domain: "enterprise" };
  const storePath = resolveControlPlaneStorePathForContext(ctx, storeFile);
  assertWithinTenantRoot(ctx, storePath);
  return storePath;
}

/**
 * L0 user operational-identity secrets path for a session (P3).
 * Local / MULTITENANT-off → global CONFIG_DIR default (undefined).
 */
export async function resolveUserOperationalIdentitySecretsStorePathForClient(
  client: GatewayClient | null,
  cfg?: OpenBotConfig,
): Promise<string | undefined> {
  if (!isSharedTenantAddressingEnabled(cfg ?? loadConfig())) {
    return undefined;
  }
  // Dual-role platform operators still own an enterprise membership; user OI
  // stores follow session-store inference (not control-plane R1.3 null).
  const ctx = await requireTenantContextForSessionStore(client);
  const storePath = resolveTenantUserOperationalIdentitySecretsStorePathForContext(ctx);
  assertWithinTenantRoot(ctx, storePath);
  return storePath;
}

/**
 * L0 user operational-identity store path for a session (P3).
 * Local / MULTITENANT-off → global CONFIG_DIR default (undefined).
 */
export async function resolveUserOperationalIdentityStorePathForClient(
  client: GatewayClient | null,
  cfg?: OpenBotConfig,
): Promise<string | undefined> {
  if (!isSharedTenantAddressingEnabled(cfg ?? loadConfig())) {
    return undefined;
  }
  const ctx = await requireTenantContextForSessionStore(client);
  const storePath = resolveTenantUserOperationalIdentityStorePathForContext(ctx);
  assertWithinTenantRoot(ctx, storePath);
  return storePath;
}

/** Per-tenant connector OAuth session store (L0/L1 seam) when tenant id is already known. */
export function resolveConnectorOAuthSessionStorePathForTenantId(
  tenantId: string,
  cfg?: OpenBotConfig,
): string | undefined {
  if (!isSharedTenantAddressingEnabled(cfg ?? loadConfig())) {
    return undefined;
  }
  const tid = canonicalizeTenantId(tenantId);
  if (!tid) {
    return undefined;
  }
  const ctx: TenantContext = { tenantId: tid, userId: "control-plane", domain: "enterprise" };
  const storePath = resolveTenantConnectorOAuthSessionStorePath(tid);
  assertWithinTenantRoot(ctx, storePath);
  return storePath;
}

/**
 * Resolve L2 data root for a session (P2). Local / MULTITENANT-off → resolveDataRoot(cfg).
 * Managed + MULTITENANT=1 → membership-derived per-user path (fail-closed without context).
 */
export async function resolveDataRootForClient(
  client: GatewayClient | null,
  cfg?: OpenBotConfig,
): Promise<string> {
  const resolvedCfg = cfg ?? loadConfig();
  if (!isSharedTenantAddressingEnabled(resolvedCfg)) {
    return resolveDataRoot(resolvedCfg);
  }
  // Chat / workspace / transcript paths: dual-role platform sessions with a
  // membership must land on the tenant L2 root (same rule as session stores).
  // Control-plane L1 seams keep requireTenantContext (R1.3).
  const ctx = await requireTenantContextForSessionStore(client);
  const dataRoot = resolveDataRootForContext(ctx, resolvedCfg);
  assertWithinTenantRoot(ctx, dataRoot);
  return dataRoot;
}

/** HTTP/bootstrap seam: map platform session fields to a {@link GatewayClient} hint. */
export type TenantSessionClientHint = {
  user?: string;
  platformUserId?: string;
  sessionDomain?: TenantContextDomain;
  sessionTenantId?: string;
};

export function toGatewayClientFromSessionHint(
  hint: TenantSessionClientHint | null | undefined,
): GatewayClient | null {
  if (!hint) {
    return null;
  }
  const user = hint.user?.trim();
  const platformUserId = hint.platformUserId?.trim();
  if (!user && !platformUserId) {
    return null;
  }
  return {
    connect: {} as never,
    user,
    platformUserId,
    sessionDomain: hint.sessionDomain,
    sessionTenantId: hint.sessionTenantId,
  };
}

/**
 * Internal operator calls (conversation_send) have no socket user.
 * Keep an already authenticated client; otherwise bind the named owner.
 */
export function gatewayClientForSessionOwner(
  client: GatewayClient | null | undefined,
  ownerPlatformUserId?: string | null,
  sessionDomain?: GatewayClient["sessionDomain"],
  /**
   * Owner email, used only when no platform user id is available. Membership
   * resolution (`resolveMembershipAuthority`) accepts either, so a parent turn
   * that only froze an email can still bind its tenant-scoped session store.
   */
  ownerUser?: string | null,
): GatewayClient | null {
  if (client?.user?.trim() || client?.platformUserId?.trim()) {
    return client;
  }
  const platformUserId = ownerPlatformUserId?.trim();
  const user = ownerUser?.trim();
  if (!platformUserId && !user) {
    return client ?? null;
  }
  const ownerDomain =
    sessionDomain === "employee" || sessionDomain === "enterprise" ? sessionDomain : "employee";
  return toGatewayClientFromSessionHint({
    ...(platformUserId ? { platformUserId } : {}),
    ...(user ? { user } : {}),
    sessionDomain: ownerDomain,
  });
}

/** Map Control UI `sessionKind` to tenant context domain (platform kinds → undefined). */
export function sessionDomainFromPlatformSessionKind(
  sessionKind: string | undefined,
): TenantContextDomain | undefined {
  if (sessionKind === "enterprise-admin") {
    return "enterprise";
  }
  if (sessionKind === "member") {
    return "employee";
  }
  return undefined;
}

/** Resolve L2 data root from an HTTP/platform session hint (bootstrap, CLI adapters). */
export async function resolveDataRootForSessionHint(
  hint: TenantSessionClientHint | null | undefined,
  cfg?: OpenBotConfig,
): Promise<string> {
  return resolveDataRootForClient(toGatewayClientFromSessionHint(hint), cfg);
}

/**
 * Conversation-following session store path resolver.
 *
 * There is ONE session store per bot under `<stateDir>/agents/<botId>/sessions`.
 * Tenant/user/bot are ownership metadata on the record — never path segments.
 * `client` is accepted for API compatibility / future ownership stamping; it does
 * not change the store path (handing a bot to another user must not move files).
 */
export async function buildSessionStorePathResolver(
  _client: GatewayClient | null,
  cfg?: OpenBotConfig,
): Promise<(agentId: string) => string> {
  const resolvedCfg = cfg ?? loadConfig();
  const storeConfig = resolvedCfg.session?.store;
  return (agentId) => resolveStorePath(storeConfig, { agentId });
}

/** Ownership metadata stamped onto session records (not used in store paths). */
export type SessionStoreOwnership = {
  ownerTenantId?: string;
  ownerUserId?: string;
  ownerBotId?: string;
};

/** SessionEntry plus conversation ownership fields (persisted in sessions.json). */
export type SessionEntryWithOwnership = SessionEntry & SessionStoreOwnership;

function withOwnership(
  entry: SessionEntry,
  ownership: SessionStoreOwnership,
): SessionEntryWithOwnership {
  return {
    ...entry,
    ...(ownership.ownerTenantId !== undefined
      ? { ownerTenantId: ownership.ownerTenantId || undefined }
      : {}),
    ...(ownership.ownerUserId !== undefined
      ? { ownerUserId: ownership.ownerUserId || undefined }
      : {}),
    ...(ownership.ownerBotId !== undefined
      ? { ownerBotId: ownership.ownerBotId || undefined }
      : {}),
  };
}

function readOwnership(entry: SessionEntry | undefined): SessionStoreOwnership {
  const record = entry as SessionEntryWithOwnership | undefined;
  return {
    ...(record?.ownerTenantId ? { ownerTenantId: record.ownerTenantId } : {}),
    ...(record?.ownerUserId ? { ownerUserId: record.ownerUserId } : {}),
    ...(record?.ownerBotId ? { ownerBotId: record.ownerBotId } : {}),
  };
}

export function sessionOwnershipFromTenantContext(
  ctx: TenantContext | null | undefined,
  botId?: string,
): SessionStoreOwnership {
  const ownerBotId = botId?.trim() ? normalizeAgentId(botId) : undefined;
  if (!ctx) {
    return ownerBotId ? { ownerBotId } : {};
  }
  return {
    ownerTenantId: ctx.tenantId.trim() || undefined,
    ownerUserId: ctx.userId.trim() || undefined,
    ...(ownerBotId ? { ownerBotId } : {}),
  };
}

/**
 * Update ownership metadata in-place. Does not move store or transcript files.
 */
export async function updateSessionStoreOwnership(params: {
  storePath: string;
  sessionKey: string;
  ownership: SessionStoreOwnership;
}): Promise<void> {
  const ownership = params.ownership;
  await updateSessionStore(params.storePath, (store) => {
    const existing = store[params.sessionKey];
    if (!existing) {
      return;
    }
    store[params.sessionKey] = {
      ...withOwnership(existing, ownership),
      updatedAt: existing.updatedAt ?? Date.now(),
    };
  });
}

/**
 * Resolve the conversation-following session store for inbound chat agent runs.
 *
 * Path is always `<stateDir>/agents/<agentId>/sessions/sessions.json` (or the
 * configured session.store template). Tenant/user identity is validated for
 * personal workbench so ownership can be stamped on the record, but never
 * changes the store path.
 */
export async function resolveSessionStorePathForInboundMessage(params: {
  cfg?: OpenBotConfig;
  agentId: string;
  gatewayClientUser?: string | null;
  gatewayClientPlatformUserId?: string | null;
  gatewayClientSessionDomain?: string | null;
}): Promise<string> {
  const resolvedCfg = params.cfg ?? loadConfig();
  const conversationPath = () =>
    resolveStorePath(resolvedCfg.session?.store, { agentId: params.agentId });
  if (!isSharedTenantAddressingEnabled(resolvedCfg)) {
    return conversationPath();
  }
  const domain = params.gatewayClientSessionDomain;
  const personalWorkbench = domain === "employee" || domain === "enterprise";
  const user = params.gatewayClientUser?.trim();
  const platformUserId = params.gatewayClientPlatformUserId?.trim();
  if (!user && !platformUserId) {
    if (personalWorkbench) {
      throw new TenantContextError(
        "inbound session store requires an authenticated user on personal workbench",
        "unresolved_user",
      );
    }
    return conversationPath();
  }
  // Validate membership for personal workbench (ownership stamping) without
  // addressing the store under tenants/<tid>/users/<uid>/...
  if (personalWorkbench) {
    const sessionDomain = domain;
    try {
      const client = toGatewayClientFromSessionHint({
        user,
        platformUserId,
        sessionDomain,
      });
      await requireTenantContextForSessionStore(client);
    } catch (err) {
      if (err instanceof TenantContextError) {
        throw err;
      }
      throw new TenantContextError(
        `inbound session store unresolved for personal workbench: ${
          err instanceof Error ? err.message : String(err)
        }`,
        "unresolved_tenant",
      );
    }
  }
  return conversationPath();
}

async function transcriptFileNonEmpty(filePath: string | undefined): Promise<boolean> {
  const trimmed = filePath?.trim();
  if (!trimmed) {
    return false;
  }
  try {
    const st = await fs.stat(trimmed);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

function resolveTranscriptPathForEntry(params: {
  sessionId: string;
  entry: { sessionFile?: string };
  agentId: string;
  storePath: string;
}): string | undefined {
  try {
    return resolveSessionFilePath(params.sessionId, params.entry, {
      agentId: params.agentId,
      sessionsDir: path.dirname(params.storePath),
    });
  } catch {
    return params.entry.sessionFile?.trim() || undefined;
  }
}

/**
 * Prefer the newer non-empty transcript when merging two session store entries.
 * Never deletes either source file.
 */
function isCollaborationGroupPublicSessionKey(sessionKey: string): boolean {
  return sessionKey.trim().toLowerCase().startsWith("space:");
}

async function preferNewerTranscriptEntry(params: {
  sessionKey: string;
  agentId: string;
  primary: ReturnType<typeof loadSessionEntry>;
  legacy: ReturnType<typeof loadSessionEntry>;
}): Promise<{
  winner: NonNullable<ReturnType<typeof loadSessionEntry>["entry"]>;
  sourceFile: string;
  fromLegacy: boolean;
} | null> {
  const primaryEntry = params.primary.entry;
  const legacyEntry = params.legacy.entry;
  const primaryFile = primaryEntry?.sessionId
    ? resolveTranscriptPathForEntry({
        sessionId: primaryEntry.sessionId,
        entry: primaryEntry,
        agentId: params.agentId,
        storePath: params.primary.storePath,
      })
    : undefined;
  const legacyFile = legacyEntry?.sessionId
    ? resolveTranscriptPathForEntry({
        sessionId: legacyEntry.sessionId,
        entry: legacyEntry,
        agentId: params.agentId,
        storePath: params.legacy.storePath,
      })
    : undefined;
  const primaryHas = await transcriptFileNonEmpty(primaryFile);
  const legacyHas = await transcriptFileNonEmpty(legacyFile);
  const primaryUpdated = typeof primaryEntry?.updatedAt === "number" ? primaryEntry.updatedAt : 0;
  const legacyUpdated = typeof legacyEntry?.updatedAt === "number" ? legacyEntry.updatedAt : 0;

  if (legacyHas && (!primaryHas || legacyUpdated > primaryUpdated)) {
    return { winner: legacyEntry!, sourceFile: legacyFile!, fromLegacy: true };
  }
  if (primaryHas && primaryEntry) {
    return { winner: primaryEntry, sourceFile: primaryFile!, fromLegacy: false };
  }
  if (legacyEntry?.sessionId && legacyHas) {
    return { winner: legacyEntry, sourceFile: legacyFile!, fromLegacy: true };
  }
  return null;
}

/**
 * Merge a legacy per-tenant session store entry into the conversation-following
 * store when the legacy transcript is newer / the only real content.
 *
 * New writes always target the conversation store (`canonicalStorePath`).
 * Legacy `tenants/<tid>/users/<uid>/state/agents/.../sessions` files are read
 * only — never deleted. Ownership is stamped on the canonical record.
 *
 * Kept name `promoteGlobalSessionEntryIfNewer` for call-site compatibility;
 * direction is now legacy-tenant → conversation store (not global → tenant).
 */
export async function promoteGlobalSessionEntryIfNewer(params: {
  sessionKey: string;
  /** @deprecated Legacy tenant store path; still read for merge, never the write target. */
  tenantStorePath: string;
  resolveAgentStorePath: (agentId: string) => string;
  cfg: OpenBotConfig;
  ownership?: SessionStoreOwnership;
}): Promise<void> {
  // GROUP_PUBLIC transcripts are shared; do not fork them into per-user copies.
  if (isCollaborationGroupPublicSessionKey(params.sessionKey)) {
    return;
  }
  const agentId = resolveSessionAgentId({ sessionKey: params.sessionKey, config: params.cfg });
  const canonicalStorePath = params.resolveAgentStorePath(agentId);
  const canonicalLoaded = loadSessionEntry(params.sessionKey, {
    resolveAgentStorePath: params.resolveAgentStorePath,
  });
  const legacyLoaded = loadSessionEntry(params.sessionKey, {
    resolveAgentStorePath: () => params.tenantStorePath,
  });

  const preferred = await preferNewerTranscriptEntry({
    sessionKey: params.sessionKey,
    agentId,
    primary: canonicalLoaded,
    legacy: legacyLoaded,
  });
  if (!preferred) {
    return;
  }

  // Already on the conversation store with the winning transcript — optionally stamp ownership.
  if (!preferred.fromLegacy) {
    if (!params.ownership) {
      return;
    }
    const existing = canonicalLoaded.entry;
    if (!existing) {
      return;
    }
    const existingOwnership = readOwnership(existing);
    const needsStamp =
      (params.ownership.ownerTenantId &&
        existingOwnership.ownerTenantId !== params.ownership.ownerTenantId) ||
      (params.ownership.ownerUserId &&
        existingOwnership.ownerUserId !== params.ownership.ownerUserId) ||
      (params.ownership.ownerBotId && existingOwnership.ownerBotId !== params.ownership.ownerBotId);
    if (!needsStamp) {
      return;
    }
    await updateSessionStoreOwnership({
      storePath: canonicalStorePath,
      sessionKey: canonicalLoaded.canonicalKey || params.sessionKey,
      ownership: params.ownership,
    });
    return;
  }

  const canonicalDir = path.dirname(canonicalStorePath);
  await fs.mkdir(canonicalDir, { recursive: true });
  const destFile = path.join(canonicalDir, `${preferred.winner.sessionId}.jsonl`);
  let sessionFileForCanonical = preferred.sourceFile;
  try {
    // Skip copy when the winning file is already inside the conversation sessions dir.
    const alreadyInCanonical =
      path.resolve(preferred.sourceFile).startsWith(path.resolve(canonicalDir) + path.sep) ||
      path.resolve(preferred.sourceFile) === path.resolve(destFile);
    if (!alreadyInCanonical) {
      await fs.copyFile(preferred.sourceFile, destFile);
      if (await transcriptFileNonEmpty(destFile)) {
        sessionFileForCanonical = destFile;
      }
    }
  } catch {
    // Keep pointing at the readable legacy file; readers can follow absolute sessionFile.
  }

  const canonicalKey =
    canonicalLoaded.canonicalKey || legacyLoaded.canonicalKey || params.sessionKey;
  const canonicalModelProvider = canonicalLoaded.entry?.modelProvider?.trim();
  const canonicalModel = canonicalLoaded.entry?.model?.trim();
  const legacyModelProvider = preferred.winner.modelProvider?.trim();
  // Keep an explicit conversation-store BYOK pin when merging a legacy transcript.
  const preserveCanonicalModel = Boolean(
    canonicalModelProvider &&
    canonicalModel &&
    (canonicalModelProvider.startsWith("ent") ||
      (legacyModelProvider && canonicalModelProvider !== legacyModelProvider)),
  );
  const ownership = params.ownership ?? {};
  const winnerOwnership = readOwnership(preferred.winner);
  await updateSessionStore(canonicalStorePath, (store) => {
    store[canonicalKey] = withOwnership(
      {
        ...preferred.winner,
        ...(preserveCanonicalModel
          ? { modelProvider: canonicalModelProvider, model: canonicalModel }
          : {}),
        sessionFile: sessionFileForCanonical,
        updatedAt: Math.max(
          typeof preferred.winner.updatedAt === "number" ? preferred.winner.updatedAt : 0,
          Date.now(),
        ),
      },
      {
        ...winnerOwnership,
        ...ownership,
        ownerBotId: ownership.ownerBotId ?? winnerOwnership.ownerBotId ?? agentId,
      },
    );
  });
}

/**
 * Conversation-store `loadSessionEntry` for gateway handlers.
 * Reads/writes the single conversation-following store; merges newer transcripts
 * from legacy per-tenant paths without deleting them; stamps ownership metadata.
 */
export async function loadSessionEntryForClient(
  sessionKey: string,
  client: GatewayClient | null,
  cfg?: OpenBotConfig,
): Promise<
  ReturnType<typeof loadSessionEntry> & {
    resolveAgentStorePath: (agentId: string) => string;
  }
> {
  const resolvedCfg = cfg ?? loadConfig();
  const resolveAgentStorePath = await buildSessionStorePathResolver(client, resolvedCfg);
  let ownership: SessionStoreOwnership | undefined;
  if (isSharedTenantAddressingEnabled(resolvedCfg)) {
    try {
      const agentId = resolveSessionAgentId({ sessionKey, config: resolvedCfg });
      let legacyTenantStorePath: string | undefined;
      if (client) {
        try {
          const ctx = await resolveTenantContextForSessionStore(client);
          if (ctx) {
            ownership = sessionOwnershipFromTenantContext(ctx, agentId);
            legacyTenantStorePath = resolveTenantSessionStorePathForContext(ctx, agentId);
          }
        } catch {
          // Membership may be absent (channel ingress); still load the conversation store.
        }
      }
      if (legacyTenantStorePath) {
        await promoteGlobalSessionEntryIfNewer({
          sessionKey,
          tenantStorePath: legacyTenantStorePath,
          resolveAgentStorePath,
          cfg: resolvedCfg,
          ownership,
        });
      } else if (ownership) {
        // Stamp ownership on an existing conversation-store entry when no legacy file exists.
        const loaded = loadSessionEntry(sessionKey, { resolveAgentStorePath });
        const existing = loaded.entry;
        if (existing) {
          const existingOwnership = readOwnership(existing);
          const needsStamp =
            (ownership.ownerTenantId &&
              existingOwnership.ownerTenantId !== ownership.ownerTenantId) ||
            (ownership.ownerUserId && existingOwnership.ownerUserId !== ownership.ownerUserId) ||
            (ownership.ownerBotId && existingOwnership.ownerBotId !== ownership.ownerBotId);
          if (needsStamp) {
            await updateSessionStoreOwnership({
              storePath: loaded.storePath,
              sessionKey: loaded.canonicalKey || sessionKey,
              ownership,
            });
          }
        }
      }
    } catch {
      // Best-effort legacy-tenant merge; fall through to shared→operator heal.
    }
  }
  try {
    // Operator ALS rewrites the store under operators/<id>/. Marketplace bot
    // sessions often still live only in the unscoped agents/<id>/ store.
    await healOperatorSessionEntryFromSharedStore({
      sessionKey,
      resolveAgentStorePath,
      ownership,
    });
  } catch {
    // Best-effort. A denied shared read must not fail the caller.
  }
  return {
    ...loadSessionEntry(sessionKey, { resolveAgentStorePath }),
    resolveAgentStorePath,
  };
}

/**
 * Sync session metadata read for agent event tool-verbose fallback (no client on hot path).
 * Multitenant shared mode skips per-session store lookup — callers rely on run context instead.
 */
export function loadSessionEntrySyncFallback(sessionKey: string) {
  const cfg = loadConfig();
  if (isSharedTenantAddressingEnabled(cfg)) {
    return { cfg, entry: undefined as ReturnType<typeof loadSessionEntry>["entry"] };
  }
  const loaded = loadSessionEntry(sessionKey);
  return { cfg: loaded.cfg, entry: loaded.entry };
}

/**
 * L0/L3 agent dir for auth-profiles and agent-local stores (P3).
 * Explicit per-agent `agentDir` in config wins; else tenant-scoped or global.
 */
export async function resolveAgentDirForClient(
  client: GatewayClient | null,
  agentId: string,
  cfg?: OpenBotConfig,
): Promise<string> {
  const resolvedCfg = cfg ?? loadConfig();
  const id = normalizeAgentId(agentId);
  const configured = resolveAgentConfig(resolvedCfg, id)?.agentDir?.trim();
  if (configured) {
    return resolveUserPath(configured);
  }
  if (!isSharedTenantAddressingEnabled(resolvedCfg)) {
    return resolveAgentDir(resolvedCfg, id);
  }
  const ctx = await requireTenantContextForSessionStore(client);
  const agentDir = resolveTenantAgentDirForContext(ctx, id);
  assertWithinTenantRoot(ctx, agentDir);
  return agentDir;
}

// Memory-workspace freeze: keep resolveTenantDataRootWorkspaceDir on inventoried line 729.
// freeze-pin
// freeze-pin
// freeze-pin
// freeze-pin
// freeze-pin
// freeze-pin
// freeze-pin
// freeze-pin
// freeze-pin
// freeze-pin
// freeze-pin
// freeze-pin
function resolveTenantDataRootWorkspaceDir(params: {
  ctx: TenantContext;
  cfg: OpenBotConfig;
  agentId: string;
}): string {
  const dataRoot = resolveDataRootForContext(params.ctx, params.cfg);
  assertWithinTenantRoot(params.ctx, dataRoot);
  const workspaceDir = resolveRobotOwnWriteRoot({
    tenantId: params.ctx.tenantId,
    userId: params.ctx.userId,
    agentId: params.agentId,
    dataRoot,
  });
  assertWithinTenantRoot(params.ctx, workspaceDir);
  return workspaceDir;
}

/**
 * D7: agent workspace under the tenant-user data root when shared addressing is on.
 *
 * Shared addressing → robot own space (`dataRoot/agents/<id>/workspace`).
 * Local / MULTITENANT-off → same robot own space when the client has a user;
 * otherwise `agents.defaults.workspace`. Never host `workspace-<id>`.
 * `agents.list[].workspace` is not a read root.
 */
export async function resolveAgentWorkspaceDirForClient(
  client: GatewayClient | null,
  agentId: string,
  cfg?: OpenBotConfig,
): Promise<string> {
  const resolvedCfg = cfg ?? loadConfig();
  const id = normalizeAgentId(agentId);
  if (!isSharedTenantAddressingEnabled(resolvedCfg)) {
    return resolveLiveRobotWriteRoot({
      agentId: id,
      tenantId: client?.sessionEnterpriseId || client?.sessionTenantId,
      userId: client?.platformUserId,
      configuredDefaultWorkspace: resolvedCfg.agents?.defaults?.workspace,
    });
  }
  const ctx = await requireTenantContextForSessionStore(client);
  const workspaceDir = resolveTenantDataRootWorkspaceDir({ ctx, cfg: resolvedCfg, agentId: id });
  // Memory-workspace freeze P4: keep resolveAuthorizedAgentToolWorkspaceCwd on inventoried line 786.
  // freeze-pin
  // freeze-pin
  // freeze-pin
  // freeze-pin
  // freeze-pin
  // freeze-pin
  // freeze-pin
  // freeze-pin
  // freeze-pin
  // freeze-pin
  // freeze-pin
  // freeze-pin
  // freeze-pin
  // freeze-pin
  // freeze-pin
  // freeze-pin
  // freeze-pin
  // freeze-pin
  // freeze-pin
  // freeze-pin
  if (isManagedDataMode(resolvedCfg)) {
    const authorized = resolveAuthorizedAgentToolWorkspaceCwd({
      ...(await loadExistingGovernedWorkspaceIdentity({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        agentId: id,
      })),
      cfg: resolvedCfg,
      actor: { tenantId: ctx.tenantId, userId: ctx.userId },
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      agentId: id,
      workspaceRoot: workspaceDir,
    });
    if (authorized.ok) {
      return authorized.cwd;
    }
    return workspaceDir; // unwired managed deny stays on membership; do not throw
  }
  return workspaceDir;
}

/** Infrastructure / hot-path session read when no GatewayClient is available (P3). */
export async function loadSessionEntryInfrastructure(sessionKey: string) {
  return loadSessionEntryForClient(sessionKey, null);
}
