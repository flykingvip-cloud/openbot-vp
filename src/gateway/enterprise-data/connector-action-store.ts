import { randomUUID } from "node:crypto";
import {
  buildConnectorActionRefKey,
  type ConnectorAction,
  type ConnectorActionLifecycle,
  type ConnectorActionRef,
  type EnterpriseDataStore,
} from "./types.js";

export class EnterpriseDataStoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "EnterpriseDataStoreError";
    this.code = code;
  }
}

export function findConnectorAction(
  store: EnterpriseDataStore,
  tenantId: string,
  ref: ConnectorActionRef,
): ConnectorAction | null {
  const key = buildConnectorActionRefKey(ref);
  return (
    Object.values(store.connectorActions).find(
      (action) => action.tenantId === tenantId && buildConnectorActionRefKey(action) === key,
    ) ?? null
  );
}

export function listConnectorActions(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  connectorId?: string;
  lifecycle?: ConnectorActionLifecycle;
}): ConnectorAction[] {
  return Object.values(params.store.connectorActions)
    .filter((action) => {
      if (action.tenantId !== params.tenantId) {
        return false;
      }
      if (params.connectorId && action.connectorId !== params.connectorId) {
        return false;
      }
      if (params.lifecycle && action.lifecycle !== params.lifecycle) {
        return false;
      }
      return true;
    })
    .toSorted((left, right) => {
      const byConnector = left.connectorId.localeCompare(right.connectorId);
      if (byConnector !== 0) {
        return byConnector;
      }
      const byKey = left.actionKey.localeCompare(right.actionKey);
      if (byKey !== 0) {
        return byKey;
      }
      return left.version.localeCompare(right.version);
    });
}

export function upsertConnectorAction(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  action: Omit<ConnectorAction, "actionId" | "tenantId" | "createdAt" | "updatedAt"> & {
    actionId?: string;
  };
  nowIso: string;
}): ConnectorAction {
  if (!params.action.readOnly) {
    throw new EnterpriseDataStoreError(
      "CONNECTOR_ACTION_WRITE_FORBIDDEN",
      "Connector actions must be readOnly in the first release.",
    );
  }
  const refKey = buildConnectorActionRefKey(params.action);
  const existing = findConnectorAction(params.store, params.tenantId, params.action);
  if (existing && existing.actionId !== params.action.actionId) {
    throw new EnterpriseDataStoreError(
      "CONNECTOR_ACTION_VERSION_CONFLICT",
      `Action already exists for ${refKey}.`,
    );
  }
  const record: ConnectorAction = {
    actionId: params.action.actionId ?? existing?.actionId ?? randomUUID(),
    tenantId: params.tenantId,
    connectorId: params.action.connectorId,
    actionKey: params.action.actionKey,
    version: params.action.version,
    displayName: params.action.displayName,
    category: params.action.category,
    description: params.action.description,
    riskLevel: params.action.riskLevel,
    requiresApproval: params.action.requiresApproval,
    readOnly: true,
    outputSchema: params.action.outputSchema,
    inputSchema: params.action.inputSchema,
    lifecycle: params.action.lifecycle,
    supersededBy: params.action.supersededBy,
    createdAt: existing?.createdAt ?? params.nowIso,
    updatedAt: params.nowIso,
    createdBy: params.action.createdBy ?? existing?.createdBy,
  };
  params.store.connectorActions[record.actionId] = record;
  return record;
}

export function assertConnectorActionGrantable(action: ConnectorAction): void {
  if (action.lifecycle === "frozen" || action.lifecycle === "draft") {
    throw new EnterpriseDataStoreError(
      "CONNECTOR_ACTION_FROZEN",
      `Action ${action.actionKey}@${action.version} is not grantable.`,
    );
  }
}
