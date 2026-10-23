/**
 * Tenant-keyed enterprise BYOK model asset store.
 * Spec: `.kiro/specs/enterprise-ai-model-governance/`
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import {
  isEnterpriseModelConnectionCatalogReady,
  listEnterpriseModelConnections,
} from "./connection-store.js";
import { EnterpriseModelError } from "./errors.js";
import { buildRuntimeModelId } from "./ids.js";
import type {
  EnterpriseModelAsset,
  EnterpriseModelHealthStatus,
  EnterpriseModelProviderConnection,
} from "./types.js";

const STORE_VERSION = 1;

type Store = {
  version: number;
  assets: Record<string, EnterpriseModelAsset>;
};

function createEmptyStore(): Store {
  return { version: STORE_VERSION, assets: {} };
}

export function resolveDefaultAssetStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-enterprise-model-assets.json");
}

const withLock = createAsyncLock();

async function loadStore(storePath?: string): Promise<Store> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultAssetStorePath());
  const parsed = await readJsonFile<Partial<Store>>(resolvedPath);
  if (!parsed || typeof parsed.assets !== "object" || parsed.assets === null) {
    return createEmptyStore();
  }
  return { version: STORE_VERSION, assets: parsed.assets };
}

async function saveStore(store: Store, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultAssetStorePath());
  await writeJsonAtomic(resolvedPath, store);
}

export async function listEnterpriseModelAssets(
  tenantId: string,
  opts?: { connectionId?: string; enabledOnly?: boolean; storePath?: string },
): Promise<EnterpriseModelAsset[]> {
  const canonical = canonicalizeTenantId(tenantId);
  if (!canonical) {
    return [];
  }
  const store = await loadStore(opts?.storePath);
  return Object.values(store.assets)
    .filter((row) => {
      if (row.tenantId !== canonical) {
        return false;
      }
      if (opts?.connectionId && row.connectionId !== opts.connectionId) {
        return false;
      }
      if (opts?.enabledOnly && !row.enabled) {
        return false;
      }
      return true;
    })
    .toSorted((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function getEnterpriseModelAsset(
  tenantId: string,
  assetId: string,
  storePath?: string,
): Promise<EnterpriseModelAsset | null> {
  const canonical = canonicalizeTenantId(tenantId);
  if (!canonical) {
    return null;
  }
  const store = await loadStore(storePath);
  const row = store.assets[assetId];
  if (!row || row.tenantId !== canonical) {
    return null;
  }
  return row;
}

export async function getEnterpriseModelAssetByRuntimeId(
  tenantId: string,
  runtimeModelId: string,
  storePath?: string,
): Promise<EnterpriseModelAsset | null> {
  const canonical = canonicalizeTenantId(tenantId);
  if (!canonical) {
    return null;
  }
  const store = await loadStore(storePath);
  const needle = runtimeModelId.trim();
  return (
    Object.values(store.assets).find(
      (row) => row.tenantId === canonical && row.runtimeModelId === needle,
    ) ?? null
  );
}

/**
 * Health states a verified connection may lift into the active ceiling.
 * `unhealthy` / `degraded` stay out until an explicit later probe policy changes them.
 */
const CONNECTION_INHERITABLE_ASSET_HEALTH = new Set<EnterpriseModelHealthStatus>([
  "unknown",
  "unchecked",
]);

/** Assets that may enter ceiling / EffectiveSet: enabled + verified healthy only. */
export function isEnterpriseModelAssetRuntimeEligible(asset: EnterpriseModelAsset): boolean {
  return asset.enabled && asset.healthStatus === "healthy";
}

/**
 * Enabled assets whose own health is still `unknown` / `unchecked` may enter the
 * ceiling when their connection is already verified and healthy. Admin grant
 * writes promote those rows; chat must not wait for that write. `unhealthy` and
 * `degraded` stay out.
 */
export function isEnterpriseModelAssetRuntimeEligibleOnConnection(
  asset: EnterpriseModelAsset,
  connection: Pick<EnterpriseModelProviderConnection, "healthStatus" | "status"> | null | undefined,
): boolean {
  if (!asset.enabled) {
    return false;
  }
  if (asset.healthStatus === "healthy") {
    return true;
  }
  if (!connection || !CONNECTION_INHERITABLE_ASSET_HEALTH.has(asset.healthStatus)) {
    return false;
  }
  return (
    connection.healthStatus === "healthy" &&
    isEnterpriseModelConnectionCatalogReady(connection.status)
  );
}

/**
 * Enabled assets registered before asset health was copied from the connection
 * stay `unknown` on disk. A still-verified connection can lift those rows so
 * the admin ceiling matches the read path. Disabled assets are left untouched.
 */
export async function promoteEnabledEnterpriseModelAssets(
  tenantId: string,
  connectionId: string,
  opts?: { storePath?: string },
): Promise<number> {
  const canonical = canonicalizeTenantId(tenantId);
  const targetConnectionId = connectionId.trim();
  if (!canonical || !targetConnectionId) {
    return 0;
  }
  return withLock(async () => {
    const store = await loadStore(opts?.storePath);
    const now = new Date().toISOString();
    let changed = 0;
    for (const [id, row] of Object.entries(store.assets)) {
      if (row.tenantId !== canonical || row.connectionId !== targetConnectionId) {
        continue;
      }
      if (!row.enabled || !CONNECTION_INHERITABLE_ASSET_HEALTH.has(row.healthStatus)) {
        continue;
      }
      store.assets[id] = {
        ...row,
        healthStatus: "healthy",
        updatedAt: now,
      };
      changed += 1;
    }
    if (changed > 0) {
      await saveStore(store, opts?.storePath);
    }
    return changed;
  });
}

export async function listActiveTenantOwnedModelIds(
  tenantId: string,
  storePath?: string,
  connectionStorePath?: string,
): Promise<string[]> {
  const assets = await listEnterpriseModelAssets(tenantId, {
    enabledOnly: true,
    storePath,
  });
  const connections = await listEnterpriseModelConnections(tenantId, connectionStorePath);
  const connectionById = new Map(connections.map((row) => [row.connectionId, row]));
  return [
    ...new Set(
      assets
        .filter((asset) =>
          isEnterpriseModelAssetRuntimeEligibleOnConnection(
            asset,
            connectionById.get(asset.connectionId),
          ),
        )
        .map((asset) => asset.runtimeModelId.trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * Invalidate assets after connection endpoint/credential trust is broken:
 * disable + mark unhealthy so they leave the active ceiling immediately.
 */
export async function degradeEnterpriseModelAssetsForConnection(
  tenantId: string,
  connectionId: string,
  storePath?: string,
): Promise<number> {
  const canonical = canonicalizeTenantId(tenantId);
  if (!canonical) {
    return 0;
  }
  return withLock(async () => {
    const store = await loadStore(storePath);
    const now = new Date().toISOString();
    let changed = 0;
    for (const [id, row] of Object.entries(store.assets)) {
      if (row.tenantId !== canonical || row.connectionId !== connectionId) {
        continue;
      }
      if (!row.enabled && row.healthStatus === "unhealthy") {
        continue;
      }
      store.assets[id] = {
        ...row,
        enabled: false,
        healthStatus: "unhealthy",
        updatedAt: now,
      };
      changed += 1;
    }
    if (changed > 0) {
      await saveStore(store, storePath);
    }
    return changed;
  });
}

export async function registerEnterpriseModelAsset(
  input: {
    tenantId: string;
    connectionId: string;
    upstreamModelId: string;
    displayName?: string;
    tier?: string;
    capabilities?: string[];
    contextWindow?: number;
    cost?: EnterpriseModelAsset["cost"];
    budget?: EnterpriseModelAsset["budget"];
    enabled?: boolean;
    healthStatus?: EnterpriseModelHealthStatus;
    assetId?: string;
  },
  storePath?: string,
): Promise<EnterpriseModelAsset> {
  const canonical = canonicalizeTenantId(input.tenantId);
  if (!canonical) {
    throw new EnterpriseModelError("ENTERPRISE_MODEL_INVALID_REQUEST", "invalid tenantId");
  }
  const upstreamModelId = input.upstreamModelId.trim();
  if (!upstreamModelId) {
    throw new EnterpriseModelError("ENTERPRISE_MODEL_INVALID_REQUEST", "upstreamModelId required");
  }
  const runtimeModelId = buildRuntimeModelId({
    tenantId: canonical,
    connectionId: input.connectionId,
    upstreamModelId,
  });
  return withLock(async () => {
    const store = await loadStore(storePath);
    const duplicate = Object.values(store.assets).find(
      (row) =>
        row.tenantId === canonical &&
        row.connectionId === input.connectionId &&
        row.upstreamModelId === upstreamModelId,
    );
    if (duplicate) {
      throw new EnterpriseModelError(
        "ENTERPRISE_MODEL_INVALID_REQUEST",
        `model already registered: ${upstreamModelId}`,
      );
    }
    const now = new Date().toISOString();
    const record: EnterpriseModelAsset = {
      tenantId: canonical,
      assetId: input.assetId?.trim() || randomUUID(),
      connectionId: input.connectionId,
      runtimeModelId,
      upstreamModelId,
      displayName: input.displayName?.trim() || upstreamModelId,
      source: "enterprise",
      billingOwner: "enterprise",
      ...(input.tier ? { tier: input.tier } : {}),
      ...(input.capabilities ? { capabilities: [...input.capabilities] } : {}),
      enabled: input.enabled !== false,
      healthStatus: input.healthStatus ?? "unknown",
      ...(typeof input.contextWindow === "number" ? { contextWindow: input.contextWindow } : {}),
      ...(input.cost ? { cost: input.cost } : {}),
      ...(input.budget ? { budget: input.budget } : {}),
      createdAt: now,
      updatedAt: now,
    };
    store.assets[record.assetId] = record;
    await saveStore(store, storePath);
    return record;
  });
}

export async function updateEnterpriseModelAsset(
  input: {
    tenantId: string;
    assetId: string;
    displayName?: string;
    tier?: string | null;
    capabilities?: string[];
    enabled?: boolean;
    healthStatus?: EnterpriseModelHealthStatus;
    contextWindow?: number | null;
    cost?: EnterpriseModelAsset["cost"] | null;
    budget?: EnterpriseModelAsset["budget"] | null;
  },
  storePath?: string,
): Promise<EnterpriseModelAsset> {
  const canonical = canonicalizeTenantId(input.tenantId);
  if (!canonical) {
    throw new EnterpriseModelError("ENTERPRISE_MODEL_INVALID_REQUEST", "invalid tenantId");
  }
  return withLock(async () => {
    const store = await loadStore(storePath);
    const existing = store.assets[input.assetId];
    if (!existing || existing.tenantId !== canonical) {
      throw new EnterpriseModelError("ENTERPRISE_MODEL_NOT_FOUND", "asset not found");
    }
    const next: EnterpriseModelAsset = {
      ...existing,
      ...(input.displayName !== undefined ? { displayName: input.displayName.trim() } : {}),
      ...(input.capabilities !== undefined ? { capabilities: [...input.capabilities] } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.healthStatus !== undefined ? { healthStatus: input.healthStatus } : {}),
      updatedAt: new Date().toISOString(),
    };
    if (input.tier === null) {
      delete next.tier;
    } else if (typeof input.tier === "string") {
      next.tier = input.tier;
    }
    if (input.contextWindow === null) {
      delete next.contextWindow;
    } else if (typeof input.contextWindow === "number") {
      next.contextWindow = input.contextWindow;
    }
    if (input.cost === null) {
      delete next.cost;
    } else if (input.cost) {
      next.cost = input.cost;
    }
    if (input.budget === null) {
      delete next.budget;
    } else if (input.budget) {
      next.budget = input.budget;
    }
    store.assets[input.assetId] = next;
    await saveStore(store, storePath);
    return next;
  });
}

export async function setEnterpriseModelAssetEnabled(
  tenantId: string,
  assetId: string,
  enabled: boolean,
  storePath?: string,
): Promise<EnterpriseModelAsset> {
  return updateEnterpriseModelAsset({ tenantId, assetId, enabled }, storePath);
}

export async function deleteEnterpriseModelAssetsForConnection(
  tenantId: string,
  connectionId: string,
  storePath?: string,
): Promise<number> {
  const canonical = canonicalizeTenantId(tenantId);
  if (!canonical) {
    return 0;
  }
  return withLock(async () => {
    const store = await loadStore(storePath);
    let removed = 0;
    for (const [id, row] of Object.entries(store.assets)) {
      if (row.tenantId === canonical && row.connectionId === connectionId) {
        delete store.assets[id];
        removed += 1;
      }
    }
    if (removed > 0) {
      await saveStore(store, storePath);
    }
    return removed;
  });
}

export async function countAssetsReferencingConnection(
  tenantId: string,
  connectionId: string,
  storePath?: string,
): Promise<{ total: number; enabled: number }> {
  const assets = await listEnterpriseModelAssets(tenantId, { connectionId, storePath });
  return {
    total: assets.length,
    enabled: assets.filter((a) => a.enabled).length,
  };
}
