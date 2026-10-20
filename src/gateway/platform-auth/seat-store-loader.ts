/**
 * Tenant-aware seat-assets I/O seam.
 *
 * Hard rule: when shared tenant addressing is on and tenantId is known, agent /
 * seat mutations MUST use `tenants/<tid>/control-plane/seat-assets.json` — never
 * the process-global store. See
 * docs/design/agent-seat-binding-tenant-isolation-2026-08-04.md.
 */

import { loadConfig } from "../../config/config.js";
import { isSharedTenantAddressingEnabled } from "../../config/data-space.js";
import type { OpenBotConfig } from "../../config/types.js";
import {
  attachSeatManagedAsset,
  grantEnterpriseAccessPolicy,
  loadEnterpriseSeatAssetsStore,
  revokeEnterpriseAccessPolicy,
  saveEnterpriseSeatAssetsStore,
  type EnterpriseSeatAssetsStore,
} from "../enterprise-seat-assets-store.js";
import { resolveControlPlaneStorePathForTenantId } from "../tenant-context.js";
import { TENANT_SEAT_ASSETS_FILE } from "../tenant-store-paths.js";
import type { PlatformAuthSessionContext } from "./store-types.js";

export function resolveSeatAssetsStorePathForTenantId(
  tenantId: string | null | undefined,
  cfg?: OpenBotConfig,
): string | undefined {
  const trimmed = tenantId?.trim();
  if (!trimmed) {
    return undefined;
  }
  return resolveControlPlaneStorePathForTenantId(trimmed, TENANT_SEAT_ASSETS_FILE, cfg);
}

/**
 * When MULTITENANT is on and tenantId is known, the resolved path MUST be set.
 * Callers must not silently fall back to the global store for agent ownership.
 */
export function requireSeatAssetsStorePathForTenantId(
  tenantId: string,
  cfg?: OpenBotConfig,
): string | undefined {
  const trimmed = tenantId.trim();
  if (!trimmed) {
    throw new Error("tenantId is required for seat-assets addressing");
  }
  const path = resolveSeatAssetsStorePathForTenantId(trimmed, cfg);
  if (
    isSharedTenantAddressingEnabled(cfg ?? loadConfig()) &&
    (path === undefined || path.trim().length === 0)
  ) {
    throw new Error(
      `shared tenant addressing is enabled but seat-assets path could not be resolved for tenant "${trimmed}"`,
    );
  }
  return path;
}

export function resolveSeatAssetsStorePathFromContext(
  context: Pick<PlatformAuthSessionContext, "membership" | "enterprise"> | null | undefined,
  cfg?: OpenBotConfig,
): string | undefined {
  const tenantId = context?.membership?.enterpriseId?.trim() ?? context?.enterprise?.id?.trim();
  return resolveSeatAssetsStorePathForTenantId(tenantId, cfg);
}

export async function loadSeatAssetsStoreForTenantId(
  tenantId: string | null | undefined,
  cfg?: OpenBotConfig,
): Promise<EnterpriseSeatAssetsStore> {
  const trimmed = tenantId?.trim();
  if (!trimmed) {
    return loadEnterpriseSeatAssetsStore();
  }
  const storePath = requireSeatAssetsStorePathForTenantId(trimmed, cfg);
  return loadEnterpriseSeatAssetsStore(storePath);
}

export async function saveSeatAssetsStoreForTenantId(
  tenantId: string | null | undefined,
  store: EnterpriseSeatAssetsStore,
  cfg?: OpenBotConfig,
): Promise<void> {
  const trimmed = tenantId?.trim();
  if (!trimmed) {
    await saveEnterpriseSeatAssetsStore(undefined, store);
    return;
  }
  const storePath = requireSeatAssetsStorePathForTenantId(trimmed, cfg);
  await saveEnterpriseSeatAssetsStore(storePath, store);
}

export async function loadSeatAssetsStoreForContext(
  context: Pick<PlatformAuthSessionContext, "membership" | "enterprise"> | null | undefined,
  cfg?: OpenBotConfig,
): Promise<EnterpriseSeatAssetsStore> {
  const tenantId = context?.membership?.enterpriseId?.trim() ?? context?.enterprise?.id?.trim();
  return loadSeatAssetsStoreForTenantId(tenantId, cfg);
}

export type BindAgentAssetToSeatForTenantInput = {
  tenantId: string;
  seatId: string;
  agentId: string;
  actorUserId: string;
  nowIso?: string;
  cfg?: OpenBotConfig;
};

/**
 * Bind an agent under the caller's seat in the tenant-scoped seat-assets store
 * (plus execute grant). Never writes the process-global store when MULTITENANT is on.
 */
export async function bindAgentAssetToSeatForTenant(
  input: BindAgentAssetToSeatForTenantInput,
): Promise<EnterpriseSeatAssetsStore> {
  const tenantId = input.tenantId.trim();
  const seatId = input.seatId.trim();
  const agentId = input.agentId.trim();
  const actorUserId = input.actorUserId.trim();
  if (!tenantId || !seatId || !agentId || !actorUserId) {
    throw new Error("tenantId, seatId, agentId, and actorUserId are required");
  }
  const nowIso = input.nowIso ?? new Date().toISOString();
  const store = await loadSeatAssetsStoreForTenantId(tenantId, input.cfg);
  attachSeatManagedAsset({
    store,
    tenantId,
    seatId,
    assetType: "agent",
    assetId: agentId,
    source: "manual",
    createdBy: actorUserId,
    nowIso,
  });
  grantEnterpriseAccessPolicy({
    store,
    tenantId,
    subjectType: "employee",
    subjectId: actorUserId,
    resourceType: "agent",
    resourceId: agentId,
    action: "execute",
    nowIso,
    actorEmployeeId: actorUserId,
  });
  await saveSeatAssetsStoreForTenantId(tenantId, store, input.cfg);
  return store;
}

/** Reverse bindAgentAssetToSeatForTenant: revoke seat binding + execute grant. */
export async function unbindAgentAssetFromSeatForTenant(
  input: BindAgentAssetToSeatForTenantInput,
): Promise<void> {
  const tenantId = input.tenantId.trim();
  const seatId = input.seatId.trim();
  const agentId = input.agentId.trim();
  const actorUserId = input.actorUserId.trim();
  if (!tenantId || !seatId || !agentId || !actorUserId) {
    throw new Error("tenantId, seatId, agentId, and actorUserId are required");
  }
  const nowIso = input.nowIso ?? new Date().toISOString();
  const store = await loadSeatAssetsStoreForTenantId(tenantId, input.cfg);
  for (const binding of Object.values(store.assetBindings)) {
    if (
      binding.tenantId === tenantId &&
      binding.seatId === seatId &&
      binding.assetType === "agent" &&
      binding.assetId === agentId &&
      !binding.revokedAt
    ) {
      binding.status = "revoked";
      binding.revokedAt = nowIso;
      binding.updatedAt = nowIso;
    }
  }
  revokeEnterpriseAccessPolicy({
    store,
    tenantId,
    subjectType: "employee",
    subjectId: actorUserId,
    resourceType: "agent",
    resourceId: agentId,
    action: "execute",
    nowIso,
    actorEmployeeId: actorUserId,
  });
  await saveSeatAssetsStoreForTenantId(tenantId, store, input.cfg);
}
