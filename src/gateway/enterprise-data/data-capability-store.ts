import { randomUUID } from "node:crypto";
import { findConnectorAction, EnterpriseDataStoreError } from "./connector-action-store.js";
import { findDataSource } from "./data-source-store.js";
import type { ConnectorActionRef, DataCapability, EnterpriseDataStore } from "./types.js";

export function validateCapabilityActionRefs(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  actionRefs: ConnectorActionRef[];
}): void {
  if (params.actionRefs.length === 0) {
    throw new EnterpriseDataStoreError(
      "DATA_CAPABILITY_ACTION_REFS_REQUIRED",
      "DataCapability requires at least one actionRef.",
    );
  }
  for (const ref of params.actionRefs) {
    if (!ref.connectorId?.trim() || !ref.actionKey?.trim() || !ref.version?.trim()) {
      throw new EnterpriseDataStoreError(
        "DATA_CAPABILITY_ACTION_REF_INVALID",
        "Each actionRef must include connectorId, actionKey, and version.",
      );
    }
    const action = findConnectorAction(params.store, params.tenantId, ref);
    if (!action) {
      throw new EnterpriseDataStoreError(
        "CONNECTOR_ACTION_NOT_FOUND",
        `DataCapability references unknown action ${ref.actionKey}@${ref.version}.`,
      );
    }
  }
}

export function validateCapabilitySourceIds(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  sourceIds: string[];
}): void {
  if (params.sourceIds.length === 0) {
    throw new EnterpriseDataStoreError(
      "DATA_CAPABILITY_SOURCE_IDS_REQUIRED",
      "DataCapability requires at least one linked DataSource.",
    );
  }
  for (const sourceId of params.sourceIds) {
    if (!findDataSource(params.store, params.tenantId, sourceId)) {
      throw new EnterpriseDataStoreError(
        "DATA_SOURCE_NOT_FOUND",
        `DataCapability references unknown DataSource ${sourceId}.`,
      );
    }
  }
}

/** Source mapper guard: action connectorId must align with a linked DataSource. */
export function assertCapabilitySourceActionAlignment(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  sourceIds: string[];
  actionRefs: ConnectorActionRef[];
}): void {
  const linkedConnectorIds = new Set(
    params.sourceIds
      .map((sourceId) => findDataSource(params.store, params.tenantId, sourceId))
      .filter((source): source is NonNullable<typeof source> => source != null)
      .map((source) => source.connectorId),
  );
  for (const ref of params.actionRefs) {
    if (!linkedConnectorIds.has(ref.connectorId)) {
      throw new EnterpriseDataStoreError(
        "DATA_CAPABILITY_SOURCE_ACTION_MISMATCH",
        `Action ${ref.actionKey}@${ref.version} must align with a linked DataSource connectorId.`,
      );
    }
  }
}

export function listDataCapabilities(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  sourceId?: string;
  enabled?: boolean;
}): DataCapability[] {
  return Object.values(params.store.dataCapabilities)
    .filter((capability) => {
      if (capability.tenantId !== params.tenantId) {
        return false;
      }
      if (params.enabled != null && capability.enabled !== params.enabled) {
        return false;
      }
      if (params.sourceId && !capability.sourceIds.includes(params.sourceId)) {
        return false;
      }
      return true;
    })
    .toSorted((left, right) => left.capabilityKey.localeCompare(right.capabilityKey));
}

export function findDataCapability(
  store: EnterpriseDataStore,
  tenantId: string,
  capabilityId: string,
): DataCapability | null {
  const capability = store.dataCapabilities[capabilityId];
  if (!capability || capability.tenantId !== tenantId) {
    return null;
  }
  return capability;
}

export function upsertDataCapability(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  capability: Omit<DataCapability, "capabilityId" | "tenantId" | "createdAt" | "updatedAt"> & {
    capabilityId?: string;
  };
  nowIso: string;
}): DataCapability {
  validateCapabilityActionRefs({
    store: params.store,
    tenantId: params.tenantId,
    actionRefs: params.capability.actionRefs,
  });
  validateCapabilitySourceIds({
    store: params.store,
    tenantId: params.tenantId,
    sourceIds: params.capability.sourceIds,
  });
  assertCapabilitySourceActionAlignment({
    store: params.store,
    tenantId: params.tenantId,
    sourceIds: params.capability.sourceIds,
    actionRefs: params.capability.actionRefs,
  });
  const duplicateKey = Object.values(params.store.dataCapabilities).find(
    (capability) =>
      capability.tenantId === params.tenantId &&
      capability.capabilityKey === params.capability.capabilityKey &&
      capability.capabilityId !== params.capability.capabilityId,
  );
  if (duplicateKey) {
    throw new EnterpriseDataStoreError(
      "DATA_CAPABILITY_KEY_CONFLICT",
      `DataCapability key ${params.capability.capabilityKey} already exists.`,
    );
  }
  const existing =
    params.capability.capabilityId != null
      ? findDataCapability(params.store, params.tenantId, params.capability.capabilityId)
      : null;
  const record: DataCapability = {
    capabilityId: params.capability.capabilityId ?? existing?.capabilityId ?? randomUUID(),
    tenantId: params.tenantId,
    capabilityKey: params.capability.capabilityKey,
    displayName: params.capability.displayName,
    description: params.capability.description,
    sourceIds: [...params.capability.sourceIds],
    actionRefs: params.capability.actionRefs.map((ref) => ({ ...ref })),
    enabled: params.capability.enabled,
    createdAt: existing?.createdAt ?? params.nowIso,
    updatedAt: params.nowIso,
  };
  const seedOrigin = params.capability.seedOrigin ?? existing?.seedOrigin;
  if (seedOrigin) {
    record.seedOrigin = seedOrigin;
  }
  params.store.dataCapabilities[record.capabilityId] = record;
  return record;
}

/** Resolve actionRefs from a capability for projection / materializer use. */
export function resolveCapabilityActionRefs(
  store: EnterpriseDataStore,
  tenantId: string,
  capabilityId: string,
): ConnectorActionRef[] {
  const capability = findDataCapability(store, tenantId, capabilityId);
  if (!capability) {
    throw new EnterpriseDataStoreError("DATA_CAPABILITY_NOT_FOUND", "DataCapability not found.");
  }
  if (!capability.enabled) {
    throw new EnterpriseDataStoreError("DATA_CAPABILITY_DISABLED", "DataCapability is disabled.");
  }
  return capability.actionRefs.map((ref) => ({ ...ref }));
}

export function archiveDataCapability(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  capabilityId: string;
  nowIso: string;
}): DataCapability {
  const capability = findDataCapability(params.store, params.tenantId, params.capabilityId);
  if (!capability) {
    throw new EnterpriseDataStoreError("DATA_CAPABILITY_NOT_FOUND", "DataCapability not found.");
  }
  capability.enabled = false;
  capability.updatedAt = params.nowIso;
  return capability;
}
