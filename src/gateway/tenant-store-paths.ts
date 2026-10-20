import fs from "node:fs";
import path from "node:path";
import { isSharedTenantAddressingEnabled, resolveDataRoot } from "../config/data-space.js";
import type { OpenBotConfig } from "../config/types.js";
import { DEFAULT_AGENT_ID, normalizeAgentId } from "../routing/session-key.js";
import { CONFIG_DIR } from "../utils.js";
import {
  type EnterpriseSeatAssetsStore,
  loadEnterpriseSeatAssetsStore,
} from "./enterprise-seat-assets-store.js";
import type { TenantContext } from "./tenant-context.js";

/**
 * Per-tenant control-plane store resolution (SaaS tenant data architecture §4/§11, K-07).
 *
 * In SaaS the tenant's control-plane stores live under `tenants/<tid>/control-plane/` (not the
 * single global `CONFIG_DIR` store). This module is the one place that maps a tenant id to those
 * paths and loads them through the real store APIs (so an imported slice is a live, normalized
 * store — not just copied files). Wiring every Gateway store call site to be tenant-aware (context
 * propagation) is the remaining SaaS-infra step; this provides the resolver + reader it will use.
 */

const SAFE_TENANT_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

/** SaaS per-tenant control-plane store filenames (§11 local→SaaS mapping). */
export const TENANT_SEAT_ASSETS_FILE = "seat-assets.json";
export const TENANT_PLATFORM_AUTH_FILE = "platform-auth-slice.json";
export const TENANT_ENTERPRISE_DATA_FILE = "enterprise-data.json";

/** Base dir for per-tenant data volumes (`/data/tenants` in SaaS; `CONFIG_DIR/tenants` locally). */
export function resolveTenantsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.OPENBOT_TENANTS_ROOT?.trim() || path.join(CONFIG_DIR, "tenants");
}

export function assertSafeTenantId(tenantId: string): void {
  if (!SAFE_TENANT_ID.test(tenantId)) {
    throw new Error(`invalid tenant id: ${tenantId}`);
  }
}

/** Live data root for a tenant: `<tenantsRoot>/<tid>`. */
export function resolveTenantLiveRoot(tenantId: string, env?: NodeJS.ProcessEnv): string {
  assertSafeTenantId(tenantId);
  return path.join(resolveTenantsRoot(env), tenantId);
}

/** Control-plane dir for a tenant: `<tenantsRoot>/<tid>/control-plane`. */
export function resolveTenantControlPlaneDir(tenantId: string, env?: NodeJS.ProcessEnv): string {
  return path.join(resolveTenantLiveRoot(tenantId, env), "control-plane");
}

/** A specific per-tenant control-plane store file path. */
export function resolveTenantControlPlaneStorePath(
  tenantId: string,
  storeFile: string,
  env?: NodeJS.ProcessEnv,
): string {
  return path.join(resolveTenantControlPlaneDir(tenantId, env), storeFile);
}

/**
 * Load a tenant's imported seat-assets store through the real store API (K-07 reader). Reads
 * `tenants/<tid>/control-plane/seat-assets.json` and normalizes it into a live
 * {@link EnterpriseSeatAssetsStore} — proving the imported slice is a usable store, not just files.
 */
export async function loadTenantSeatAssetsStore(
  tenantId: string,
  env?: NodeJS.ProcessEnv,
): Promise<EnterpriseSeatAssetsStore> {
  return loadEnterpriseSeatAssetsStore(
    resolveTenantControlPlaneStorePath(tenantId, TENANT_SEAT_ASSETS_FILE, env),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Context-aware resolution (spec `tenant-context-propagation` P0 / R2·R3·R6).
// These are the single addressing exit for tenant data; they are additive and, by the R2
// fallback below, change nothing for local / self-hosted users.
// ─────────────────────────────────────────────────────────────────────────────

/** Reject a user-id path segment that could escape the tenant tree (defense-in-depth for R6). */
function assertSafeUserSegment(userId: string): void {
  if (
    !userId ||
    userId === "." ||
    userId === ".." ||
    userId.includes("/") ||
    userId.includes("\\") ||
    userId.includes("\u0000")
  ) {
    throw new Error(`invalid user id segment: ${userId}`);
  }
}

/**
 * Resolve the L2 data root for a request's tenant context (R2 / R4).
 *
 * The fallback is keyed on the DATA MODE, never on the presence of a context (expert review 高危1):
 * - **local / self-hosted** (`!isManagedDataMode`): returns exactly `resolveDataRoot(cfg)` —
 *   byte-identical to today's behavior; the per-tenant path never activates (R2 zero-change).
 * - **managed**: a resolved {@link TenantContext} is REQUIRED. A missing context is fail-CLOSED
 *   (throws) — it must never silently fall back to the single global root, which would be a
 *   cross-tenant leak if a handler forgot to resolve context.
 */
export function resolveDataRootForContext(
  ctx: TenantContext | null,
  cfg: OpenBotConfig | undefined,
): string {
  // D5: only when managed + OPENBOT_MULTITENANT; otherwise single-root resolveDataRoot.
  if (!isSharedTenantAddressingEnabled(cfg)) {
    return resolveDataRoot(cfg);
  }
  if (!ctx) {
    throw new Error(
      "shared multi-tenant addressing requires a resolved tenant context (fail-closed; refusing global fallback)",
    );
  }
  assertSafeUserSegment(ctx.userId);
  return path.join(resolveTenantLiveRoot(ctx.tenantId), "users", ctx.userId, "OpenBot");
}

/** Resolve a per-tenant control-plane store path for a request's context (R3). */
export function resolveControlPlaneStorePathForContext(
  ctx: TenantContext,
  storeFile: string,
  env?: NodeJS.ProcessEnv,
): string {
  return resolveTenantControlPlaneStorePath(ctx.tenantId, storeFile, env);
}

// ─────────────────────────────────────────────────────────────────────────────
// L3 runtime state paths (spec P3 / R9 — shared Gateway session + agent dir).
// Local / MULTITENANT-off callers keep using resolveStateDir() (zero-change).
// ─────────────────────────────────────────────────────────────────────────────

/** L3 runtime state root: `<tenantsRoot>/<tid>/users/<uid>/state`. */
export function resolveTenantRuntimeStateRootForContext(
  ctx: TenantContext,
  env?: NodeJS.ProcessEnv,
): string {
  assertSafeUserSegment(ctx.userId);
  return path.join(resolveTenantLiveRoot(ctx.tenantId, env), "users", ctx.userId, "state");
}

/** L3 agent sessions dir under the tenant-user runtime root. */
export function resolveTenantAgentSessionsDirForContext(
  ctx: TenantContext,
  agentId?: string,
  env?: NodeJS.ProcessEnv,
): string {
  const id = normalizeAgentId(agentId ?? DEFAULT_AGENT_ID);
  return path.join(resolveTenantRuntimeStateRootForContext(ctx, env), "agents", id, "sessions");
}

/** L3 agent dir (auth-profiles, growth stores) under the tenant-user runtime root. */
export function resolveTenantAgentDirForContext(
  ctx: TenantContext,
  agentId?: string,
  env?: NodeJS.ProcessEnv,
): string {
  const id = normalizeAgentId(agentId ?? DEFAULT_AGENT_ID);
  return path.join(resolveTenantRuntimeStateRootForContext(ctx, env), "agents", id, "agent");
}

/**
 * Legacy per-tenant sessions.json path (READ ONLY for merge).
 * New writes use the conversation-following store via resolveStorePath /
 * buildSessionStorePathResolver — tenant/user are ownership metadata, not path segments.
 */
export function resolveTenantSessionStorePathForContext(
  ctx: TenantContext,
  agentId?: string,
  env?: NodeJS.ProcessEnv,
): string {
  return path.join(resolveTenantAgentSessionsDirForContext(ctx, agentId, env), "sessions.json");
}

/** L0 user operational-identity store under the tenant-user runtime root. */
export function resolveTenantUserOperationalIdentityStorePathForContext(
  ctx: TenantContext,
  env?: NodeJS.ProcessEnv,
): string {
  return path.join(
    resolveTenantRuntimeStateRootForContext(ctx, env),
    "openbot-user-operational-identity.json",
  );
}

/** L0 user operational-identity secrets under the tenant-user runtime root. */
export function resolveTenantUserOperationalIdentitySecretsStorePathForContext(
  ctx: TenantContext,
  env?: NodeJS.ProcessEnv,
): string {
  return path.join(
    resolveTenantRuntimeStateRootForContext(ctx, env),
    "openbot-user-operational-identity-secrets.json",
  );
}

/** L0 connector OAuth sessions under the tenant control-plane root. */
export function resolveTenantConnectorOAuthSessionStorePath(
  tenantId: string,
  env?: NodeJS.ProcessEnv,
): string {
  return resolveTenantControlPlaneStorePath(
    tenantId,
    "openbot-enterprise-data-oauth-sessions.json",
    env,
  );
}

/**
 * Guard (R6): assert a resolved path stays within the context tenant's live root. A managed-mode
 * resolution that escapes the tenant root is an isolation bug and MUST throw, not silently
 * read/write. Callers apply this to any path they build from a {@link TenantContext}.
 */
export function assertWithinTenantRoot(
  ctx: TenantContext,
  resolved: string,
  env?: NodeJS.ProcessEnv,
): void {
  const root = path.resolve(resolveTenantLiveRoot(ctx.tenantId, env));
  const rel = path.relative(root, path.resolve(resolved));
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`resolved path escapes tenant root for ${ctx.tenantId}: ${resolved}`);
  }
}

/**
 * List every per-user agent sessions dir under a tenant live root.
 * Layout: tenants/<tid>/users/<uid>/state/agents/<agentId>/sessions
 */
export async function listTenantAgentSessionsDirs(params: {
  tenantId: string;
  agentId: string;
  env?: NodeJS.ProcessEnv;
}): Promise<string[]> {
  assertSafeTenantId(params.tenantId);
  const agentKey = normalizeAgentId(params.agentId);
  const usersRoot = path.join(resolveTenantLiveRoot(params.tenantId, params.env), "users");
  const entries = await fs.promises.readdir(usersRoot, { withFileTypes: true }).catch(() => []);
  const dirs: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    try {
      assertSafeUserSegment(entry.name);
    } catch {
      continue;
    }
    dirs.push(path.join(usersRoot, entry.name, "state", "agents", agentKey, "sessions"));
  }
  return dirs.toSorted();
}
