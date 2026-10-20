import { randomUUID } from "node:crypto";
import { findConnectorAction } from "./connector-action-store.js";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import {
  buildConnectorActionRefKey,
  type ConnectorActionRef,
  type ConnectorRuntimeRegistryEntry,
  type EnterpriseDataStore,
} from "./types.js";

export function findRuntimeRegistryEntry(
  store: EnterpriseDataStore,
  tenantId: string,
  ref: ConnectorActionRef,
): ConnectorRuntimeRegistryEntry | null {
  const key = buildConnectorActionRefKey(ref);
  return (
    Object.values(store.connectorRuntimeRegistry).find(
      (entry) => entry.tenantId === tenantId && buildConnectorActionRefKey(entry) === key,
    ) ?? null
  );
}

export function listRuntimeRegistryEntries(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  connectorId?: string;
}): ConnectorRuntimeRegistryEntry[] {
  return Object.values(params.store.connectorRuntimeRegistry)
    .filter((entry) => {
      if (entry.tenantId !== params.tenantId) {
        return false;
      }
      if (params.connectorId && entry.connectorId !== params.connectorId) {
        return false;
      }
      return true;
    })
    .toSorted((left, right) =>
      buildConnectorActionRefKey(left).localeCompare(buildConnectorActionRefKey(right)),
    );
}

export function registerRuntimeHandler(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  connectorId: string;
  actionKey: string;
  version: string;
  handlerRef: string;
  readOnly?: boolean;
  timeoutMs?: number;
  registeredBy?: string;
  nowIso: string;
}): ConnectorRuntimeRegistryEntry {
  const action = findConnectorAction(params.store, params.tenantId, params);
  if (!action) {
    throw new EnterpriseDataStoreError(
      "CONNECTOR_ACTION_NOT_FOUND",
      `Action ${params.actionKey}@${params.version} not found.`,
    );
  }
  if (action.lifecycle !== "active" && action.lifecycle !== "deprecated") {
    throw new EnterpriseDataStoreError(
      "CONNECTOR_ACTION_FROZEN",
      `Action ${params.actionKey}@${params.version} cannot register a handler.`,
    );
  }
  const readOnly = params.readOnly ?? true;
  if (!readOnly) {
    throw new EnterpriseDataStoreError(
      "CONNECTOR_ACTION_WRITE_FORBIDDEN",
      "Runtime handlers must be readOnly in the first release.",
    );
  }
  const existing = findRuntimeRegistryEntry(params.store, params.tenantId, params);
  const entry: ConnectorRuntimeRegistryEntry = {
    registryId: existing?.registryId ?? randomUUID(),
    tenantId: params.tenantId,
    connectorId: params.connectorId,
    actionKey: params.actionKey,
    version: params.version,
    handlerRef: params.handlerRef,
    readOnly: true,
    timeoutMs: params.timeoutMs ?? 30_000,
    registeredAt: existing?.registeredAt ?? params.nowIso,
    registeredBy: params.registeredBy ?? existing?.registeredBy,
  };
  params.store.connectorRuntimeRegistry[entry.registryId] = entry;
  return entry;
}

export function resolveRuntimeHandler(
  store: EnterpriseDataStore,
  tenantId: string,
  ref: ConnectorActionRef,
): ConnectorRuntimeRegistryEntry {
  const entry = findRuntimeRegistryEntry(store, tenantId, ref);
  if (!entry) {
    throw new EnterpriseDataStoreError(
      "CONNECTOR_ACTION_NOT_REGISTERED",
      `No runtime handler registered for ${ref.actionKey}@${ref.version}.`,
    );
  }
  return entry;
}
