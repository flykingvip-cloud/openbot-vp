/**
 * Enterprise managed data-plane discovery for system jobs (retention cron, etc.).
 * Fail-closed: never invent tenants; only enumerate safe on-disk / configured ids.
 */
import fs from "node:fs";
import path from "node:path";
import type { OpenBotConfig } from "../config/config.js";
import {
  isManagedDataMode,
  isSharedTenantAddressingEnabled,
  resolveDataRoot,
} from "../config/data-space.js";
import {
  assertSafeTenantId,
  resolveTenantLiveRoot,
  resolveTenantsRoot,
} from "../gateway/tenant-store-paths.js";
import { computeLocalDataPlaneId, computeManagedDataPlaneId } from "./tenant-context.js";
import type { ConversationTenantContext } from "./types.js";

const SAFE_TENANT_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

export type ManagedPlaneTarget = {
  mode: "local" | "managed";
  tenantId: string | null;
  dataPlaneId: string;
  /** Filesystem root used for Catalog / cold / exports for this plane. */
  dataRoot: string;
};

/**
 * List tenant ids under OPENBOT_TENANTS_ROOT (directory names only).
 */
export function listTenantIdsFromVolume(env: NodeJS.ProcessEnv = process.env): string[] {
  const root = resolveTenantsRoot(env);
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && SAFE_TENANT_ID.test(e.name))
      .map((e) => e.name)
      .toSorted();
  } catch {
    return [];
  }
}

/**
 * Explicit allow-list from env (comma-separated). Empty → unrestricted enumeration.
 */
export function listConfiguredRetentionTenantIds(
  env: NodeJS.ProcessEnv = process.env,
): string[] | null {
  const raw =
    env.OPENBOT_CONVERSATION_RETENTION_TENANT_IDS?.trim() ||
    env.OPENBOT_RETENTION_TENANT_IDS?.trim() ||
    "";
  if (!raw) {
    return null;
  }
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => SAFE_TENANT_ID.test(t));
}

/**
 * Single default tenant for managed non-multitenant (one tenant per process).
 */
export function resolveDefaultManagedTenantId(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw =
    env.OPENBOT_DEFAULT_TENANT_ID?.trim() ||
    env.OPENBOT_TENANT_ID?.trim() ||
    env.OPENCLAW_TENANT_ID?.trim() ||
    "";
  if (!raw || !SAFE_TENANT_ID.test(raw)) {
    return null;
  }
  return raw;
}

/**
 * Resolve filesystem data root for a conversation tenant context.
 * - local: resolveDataRoot(cfg)
 * - managed + multitenant: tenants/<tid> live root
 * - managed single: tenants/<tid> if known, else shared data root
 */
export function resolveConversationDataRoot(params: {
  cfg?: OpenBotConfig;
  tenantId?: string | null;
  mode?: "local" | "managed";
  env?: NodeJS.ProcessEnv;
}): string {
  const env = params.env ?? process.env;
  const mode = params.mode ?? (isManagedDataMode(params.cfg) ? "managed" : "local");
  if (mode === "local" || !params.tenantId) {
    return resolveDataRoot(params.cfg, env);
  }
  // Fail-closed: never fall back to the global data root for an illegal tenant id
  // (would mix tenant planes — v1.2 security).
  try {
    assertSafeTenantId(params.tenantId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`INVALID_TENANT_ID: ${msg}`, { cause: err });
  }
  if (isSharedTenantAddressingEnabled(params.cfg, env) || isManagedDataMode(params.cfg)) {
    return resolveTenantLiveRoot(params.tenantId, env);
  }
  return resolveDataRoot(params.cfg, env);
}

/**
 * Build system principal context for a managed/local plane.
 */
export function buildSystemPlaneContext(params: {
  cfg?: OpenBotConfig;
  tenantId: string | null;
  mode: "local" | "managed";
  env?: NodeJS.ProcessEnv;
}): ConversationTenantContext {
  const env = params.env ?? process.env;
  if (params.mode === "managed") {
    if (!params.tenantId) {
      throw new Error("managed plane requires tenantId");
    }
    const dataPlaneId = computeManagedDataPlaneId(params.tenantId);
    return {
      dataPlaneId,
      tenantId: params.tenantId,
      principalId: "system:retention-cron",
      seatId: null,
      groupIds: [],
      roles: ["admin", "governance_admin", "system"],
      mode: "managed",
    };
  }
  const dataRoot = resolveDataRoot(params.cfg, env);
  return {
    dataPlaneId: computeLocalDataPlaneId(dataRoot),
    tenantId: null,
    principalId: "system:retention-cron",
    seatId: null,
    groupIds: [],
    roles: ["admin", "governance_admin", "system"],
    mode: "local",
  };
}

/**
 * Enumerate all planes a system retention tick should visit.
 *
 * - local: single local plane
 * - managed + multitenant: each tenant under tenants root (optionally filtered)
 * - managed single-tenant: OPENBOT_DEFAULT_TENANT_ID only (fail closed if missing)
 */
export function listRetentionPlaneTargets(params: {
  cfg?: OpenBotConfig;
  env?: NodeJS.ProcessEnv;
}): ManagedPlaneTarget[] {
  const env = params.env ?? process.env;
  const cfg = params.cfg;

  if (!isManagedDataMode(cfg)) {
    const dataRoot = resolveDataRoot(cfg, env);
    return [
      {
        mode: "local",
        tenantId: null,
        dataPlaneId: computeLocalDataPlaneId(dataRoot),
        dataRoot,
      },
    ];
  }

  const allowList = listConfiguredRetentionTenantIds(env);
  let tenantIds: string[];

  if (isSharedTenantAddressingEnabled(cfg, env)) {
    tenantIds = listTenantIdsFromVolume(env);
    if (allowList) {
      const allowed = new Set(allowList);
      tenantIds = tenantIds.filter((t) => allowed.has(t));
    }
  } else {
    const single = resolveDefaultManagedTenantId(env);
    tenantIds = single ? [single] : (allowList ?? []);
  }

  // Deduplicate + validate
  const seen = new Set<string>();
  const planes: ManagedPlaneTarget[] = [];
  for (const tenantId of tenantIds) {
    if (seen.has(tenantId) || !SAFE_TENANT_ID.test(tenantId)) {
      continue;
    }
    seen.add(tenantId);
    try {
      assertSafeTenantId(tenantId);
    } catch {
      continue;
    }
    const dataRoot = resolveConversationDataRoot({
      cfg,
      tenantId,
      mode: "managed",
      env,
    });
    planes.push({
      mode: "managed",
      tenantId,
      dataPlaneId: computeManagedDataPlaneId(tenantId),
      dataRoot,
    });
  }

  return planes;
}

/**
 * Catalog path for a managed/local plane (explicit dataRoot, no global fallback mix-up).
 */
export function resolveCatalogPathForPlane(params: {
  dataRoot: string;
  mode: "local" | "managed";
  tenantId: string | null;
}): string {
  if (params.mode === "managed" && params.tenantId) {
    // Prefer plane-local catalog under tenant live root (strong isolation).
    return path.join(params.dataRoot, ".meta", "conversations", "catalog.sqlite");
  }
  return path.join(params.dataRoot, ".meta", "conversations", "catalog.sqlite");
}
