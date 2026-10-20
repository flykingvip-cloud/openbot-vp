import { randomUUID } from "node:crypto";
import { listConnectorActions, EnterpriseDataStoreError } from "./connector-action-store.js";
import { findDataConnectorDefinition } from "./connector-catalog.js";
import type { DataSource, EnterpriseDataStore } from "./types.js";

export function listDataSources(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  category?: DataSource["category"];
}): DataSource[] {
  return Object.values(params.store.dataSources)
    .filter((source) => {
      if (source.tenantId !== params.tenantId) {
        return false;
      }
      if (params.category && source.category !== params.category) {
        return false;
      }
      return true;
    })
    .toSorted((left, right) => left.sourceKey.localeCompare(right.sourceKey));
}

export function findDataSource(
  store: EnterpriseDataStore,
  tenantId: string,
  sourceId: string,
): DataSource | null {
  const source = store.dataSources[sourceId];
  if (!source || source.tenantId !== tenantId) {
    return null;
  }
  return source;
}

export function findDataSourceByKey(
  store: EnterpriseDataStore,
  tenantId: string,
  sourceKey: string,
): DataSource | null {
  return (
    Object.values(store.dataSources).find(
      (source) => source.tenantId === tenantId && source.sourceKey === sourceKey,
    ) ?? null
  );
}

export function upsertDataSource(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  source: Omit<DataSource, "sourceId" | "tenantId" | "createdAt" | "updatedAt"> & {
    sourceId?: string;
  };
  nowIso: string;
}): DataSource {
  if (!params.source.connectorId?.trim()) {
    throw new EnterpriseDataStoreError(
      "DATA_SOURCE_CONNECTOR_REQUIRED",
      "DataSource must reference a connectorId.",
    );
  }
  const existingByKey = findDataSourceByKey(params.store, params.tenantId, params.source.sourceKey);
  if (existingByKey && existingByKey.sourceId !== params.source.sourceId) {
    throw new EnterpriseDataStoreError(
      "DATA_SOURCE_KEY_CONFLICT",
      `DataSource key ${params.source.sourceKey} already exists.`,
    );
  }
  const existing =
    params.source.sourceId != null
      ? findDataSource(params.store, params.tenantId, params.source.sourceId)
      : existingByKey;
  const sourceId = params.source.sourceId ?? existing?.sourceId ?? randomUUID();
  const definition = findDataConnectorDefinition(params.source.connectorId);
  const accessMethod =
    params.source.accessMethod ?? definition?.accessMethod ?? existing?.accessMethod;
  const requestedBinding = params.source.bindingId?.trim() || undefined;
  const bindingId =
    requestedBinding ?? (accessMethod === "website_session" ? existing?.bindingId : undefined);
  const credentialId = params.source.credentialId?.trim() || undefined;
  if (accessMethod !== "website_session") {
    const connectorActions = listConnectorActions({
      store: params.store,
      tenantId: params.tenantId,
      connectorId: params.source.connectorId,
    });
    if (connectorActions.length === 0) {
      throw new EnterpriseDataStoreError(
        "DATA_SOURCE_CONNECTOR_UNREGISTERED",
        `Connector ${params.source.connectorId} has no registered actions for this tenant.`,
      );
    }
  }
  if (accessMethod === "website_session") {
    if (credentialId) {
      throw new EnterpriseDataStoreError(
        "DATA_SOURCE_ACCOUNT_KIND",
        "Website session sources reference AccountBinding.bindingId and cannot store an api_key credential.",
      );
    }
    if (!bindingId) {
      throw new EnterpriseDataStoreError(
        "DATA_SOURCE_BINDING_REQUIRED",
        "Website session DataSource requires AccountBinding.bindingId.",
      );
    }
    const sharedBinding = Object.values(params.store.dataSources).find(
      (source) =>
        source.tenantId === params.tenantId &&
        source.connectorId === params.source.connectorId &&
        source.sourceId !== sourceId &&
        source.bindingId === bindingId,
    );
    if (sharedBinding) {
      throw new EnterpriseDataStoreError(
        "DATA_SOURCE_BINDING_SHARED",
        `AccountBinding ${bindingId} is already used by source ${sharedBinding.sourceId}.`,
      );
    }
  }
  if (credentialId) {
    const sharedCredential = Object.values(params.store.dataSources).find(
      (source) =>
        source.tenantId === params.tenantId &&
        source.connectorId === params.source.connectorId &&
        source.sourceId !== sourceId &&
        source.credentialId === credentialId,
    );
    if (sharedCredential) {
      throw new EnterpriseDataStoreError(
        "DATA_SOURCE_CREDENTIAL_SHARED",
        `Credential ${credentialId} is already used by source ${sharedCredential.sourceId}.`,
      );
    }
  }
  const record: DataSource = {
    sourceId,
    tenantId: params.tenantId,
    sourceKey: params.source.sourceKey,
    displayName: params.source.displayName,
    category: params.source.category,
    status: params.source.status,
    connectorId: params.source.connectorId,
    credentialId,
    accessMethod,
    bindingId,
    createdAt: existing?.createdAt ?? params.nowIso,
    updatedAt: params.nowIso,
  };
  // Observation clocks are not record edits. Client payloads cannot set them.
  if (existing?.lastCheckedAt) {
    record.lastCheckedAt = existing.lastCheckedAt;
  }
  if (existing?.lastSucceededAt) {
    record.lastSucceededAt = existing.lastSucceededAt;
  }
  if (existing?.lastMaterializedAt) {
    record.lastMaterializedAt = existing.lastMaterializedAt;
  }
  if (existing?.materializationCount != null) {
    record.materializationCount = existing.materializationCount;
  }
  params.store.dataSources[record.sourceId] = record;
  return record;
}

export function archiveDataSource(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  sourceId: string;
  nowIso: string;
}): DataSource {
  const source = findDataSource(params.store, params.tenantId, params.sourceId);
  if (!source) {
    throw new EnterpriseDataStoreError("DATA_SOURCE_NOT_FOUND", "DataSource not found.");
  }
  source.status = "disconnected";
  source.updatedAt = params.nowIso;
  return source;
}
