import path from "node:path";
import type { OpenBotConfig } from "../config/config.js";
import { applyMergePatch, createMergePatch } from "../config/merge-patch.js";
import { readJsonFile, writeJsonAtomic } from "../infra/json-files.js";
import { CONFIG_DIR, isPlainObject, resolveUserPath } from "../utils.js";
import { canonicalizeTenantId } from "./tenant-canonicalization.js";

/**
 * Tenant-scoped configuration overrides (Phase 2, decision "C").
 *
 * Design constraints (see `.kiro/specs/ops-decommission/design.md`):
 * - Single global JSON keyed by `tenantId` (mirrors enterprise-data/store.ts),
 *   NOT per-tenant files and NOT a subtree of `openbot.json`.
 * - The runtime is still a single global `channels`/`agents` instance; this
 *   module only delivers "tenant-level channel credential isolation" at the
 *   config-resolution layer. "Per-tenant independent channel runtime instances"
 *   is a separate, later Runtime Phase (tasks.md Phase 8 / task 8.1).
 * - `resolveConfigForTenant` is a pure, idempotent merge seam so that callers
 *   can resolve `merge(platformDefault, tenantOverride)` without touching the
 *   process-global runtime snapshot.
 */

export const TENANT_CONFIG_STORE_VERSION = 1;

const DEFAULT_STORE_FILENAME = "openbot-tenant-config.json";

/** A JSON merge-patch (RFC 7396) subtree layered onto the platform default config. */
export type TenantConfigOverride = Record<string, unknown>;

export type TenantConfigRecord = {
  tenantId: string;
  override: TenantConfigOverride;
  updatedAt: string;
};

export type TenantConfigStore = {
  version: number;
  tenants: Record<string, TenantConfigRecord>;
};

export function resolveDefaultTenantConfigStorePath(): string {
  return path.join(CONFIG_DIR, DEFAULT_STORE_FILENAME);
}

function canonicalTenantKey(tenantId: string): string {
  return canonicalizeTenantId(tenantId) ?? tenantId.trim();
}

function normalizeOverride(value: unknown): TenantConfigOverride {
  return isPlainObject(value) ? (value as TenantConfigOverride) : {};
}

export function normalizeTenantConfigStore(
  parsed: Partial<TenantConfigStore> | null | undefined,
): TenantConfigStore {
  const tenants: Record<string, TenantConfigRecord> = {};
  for (const [rawId, record] of Object.entries(parsed?.tenants ?? {})) {
    const canonical = canonicalTenantKey(record?.tenantId ?? rawId);
    if (!canonical) {
      continue;
    }
    tenants[canonical] = {
      tenantId: canonical,
      override: normalizeOverride(record?.override),
      updatedAt:
        typeof record?.updatedAt === "string" && record.updatedAt
          ? record.updatedAt
          : new Date(0).toISOString(),
    };
  }
  return {
    version: parsed?.version ?? TENANT_CONFIG_STORE_VERSION,
    tenants,
  };
}

export async function loadTenantConfigStore(storePath?: string): Promise<TenantConfigStore> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultTenantConfigStorePath());
  const parsed = await readJsonFile<Partial<TenantConfigStore>>(resolvedPath);
  return normalizeTenantConfigStore(parsed);
}

export async function saveTenantConfigStore(
  store: TenantConfigStore,
  storePath?: string,
): Promise<void> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultTenantConfigStorePath());
  await writeJsonAtomic(resolvedPath, normalizeTenantConfigStore(store));
}

/** Return a tenant's override subtree, or `null` when none is stored. */
export function getTenantConfigOverride(
  store: TenantConfigStore,
  tenantId: string,
): TenantConfigOverride | null {
  const canonical = canonicalTenantKey(tenantId);
  if (!canonical) {
    return null;
  }
  return store.tenants[canonical]?.override ?? null;
}

/**
 * Upsert a tenant's override subtree. Pure: returns a new store, leaving the
 * input untouched (and never touching other tenants' records).
 */
export function setTenantConfigOverride(
  store: TenantConfigStore,
  tenantId: string,
  override: TenantConfigOverride,
  now: () => Date = () => new Date(),
): TenantConfigStore {
  const canonical = canonicalTenantKey(tenantId);
  if (!canonical) {
    return store;
  }
  return {
    version: store.version,
    tenants: {
      ...store.tenants,
      [canonical]: {
        tenantId: canonical,
        override: normalizeOverride(override),
        updatedAt: now().toISOString(),
      },
    },
  };
}

function coerceTenantConfig(value: unknown): OpenBotConfig {
  return isPlainObject(value) ? (value as OpenBotConfig) : {};
}

/**
 * Resolve the effective config for a tenant: `merge(platformDefault, override)`.
 *
 * Pure and idempotent: `resolve(resolve(d, o), o) === resolve(d, o)`.
 *
 * Uses plain RFC-7396 merge-patch semantics: arrays in the override (e.g.
 * `channels.<id>.accounts[]`) REPLACE the platform default array wholesale
 * rather than merging by id. This is deliberate for credential isolation — a
 * tenant fully owns its account list, so platform-level accounts never leak
 * into a tenant's resolved runtime config.
 */
export function resolveConfigForTenant(params: {
  platformDefault: OpenBotConfig;
  override?: TenantConfigOverride | null;
}): OpenBotConfig {
  const override = params.override;
  if (!override || Object.keys(override).length === 0) {
    return params.platformDefault;
  }
  return coerceTenantConfig(applyMergePatch(params.platformDefault, override));
}

/**
 * Reduce a full tenant config to the minimal override (delta) relative to the
 * platform default, suitable for storage. Round-trips with `resolveConfigForTenant`:
 * `resolve(platformDefault, diffTenantOverride(platformDefault, tenantConfig))`
 * reconstructs `tenantConfig`.
 */
export function diffTenantOverride(
  platformDefault: OpenBotConfig,
  tenantConfig: OpenBotConfig,
): TenantConfigOverride {
  const patch = createMergePatch(platformDefault, tenantConfig);
  return isPlainObject(patch) ? (patch as TenantConfigOverride) : {};
}
