import { HTTP_REST_READ_HANDLER_REF } from "./adapters/http-rest.js";
import { listConnectorActions, upsertConnectorAction } from "./connector-action-store.js";
import { registerRuntimeHandler } from "./runtime-registry.js";
import type { EnterpriseDataStore } from "./types.js";

const HTTP_REST_READ_OUTPUT_V1 = {
  type: "object",
  properties: {
    resource: {},
  },
} as const;

export function seedHttpRestConnectorPackage(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  nowIso: string;
}): void {
  upsertConnectorAction({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    action: {
      connectorId: "http-rest",
      actionKey: "external.resource.read",
      version: "v1",
      displayName: "REST 资源读取",
      category: "external",
      riskLevel: "LOW",
      requiresApproval: false,
      readOnly: true,
      outputSchema: HTTP_REST_READ_OUTPUT_V1,
      lifecycle: "active",
    },
  });
  registerRuntimeHandler({
    store: params.store,
    tenantId: params.tenantId,
    connectorId: "http-rest",
    actionKey: "external.resource.read",
    version: "v1",
    handlerRef: HTTP_REST_READ_HANDLER_REF,
    nowIso: params.nowIso,
  });
}

export function ensureHttpRestConnectorPackage(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  nowIso: string;
}): { installed: boolean; actionCount: number } {
  const existing = listConnectorActions({
    store: params.store,
    tenantId: params.tenantId,
    connectorId: "http-rest",
  });
  if (existing.length > 0) {
    return { installed: false, actionCount: existing.length };
  }
  seedHttpRestConnectorPackage(params);
  const actionCount = listConnectorActions({
    store: params.store,
    tenantId: params.tenantId,
    connectorId: "http-rest",
  }).length;
  return { installed: true, actionCount };
}
