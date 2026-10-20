import { POSTGRES_READ_HANDLER_REF } from "./adapters/postgres.js";
import { listConnectorActions, upsertConnectorAction } from "./connector-action-store.js";
import { registerRuntimeHandler } from "./runtime-registry.js";
import type { EnterpriseDataStore } from "./types.js";

const POSTGRES_READ_OUTPUT_V1 = {
  type: "object",
  properties: {
    rows: { type: "array" },
    rowCount: { type: "number" },
  },
} as const;

const POSTGRES_READ_INPUT_V1 = {
  type: "object",
  properties: {
    sql: {
      type: "string",
      description: "只读 SQL（SELECT / WITH）。留空默认执行 SELECT 1。",
    },
  },
} as const;

export function seedPostgresConnectorPackage(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  nowIso: string;
}): void {
  upsertConnectorAction({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    action: {
      connectorId: "db-postgres",
      actionKey: "db.query.read",
      version: "v1",
      displayName: "PostgreSQL 只读查询",
      category: "external",
      // Read-only at the action level; recommend a read-only DB role at the source.
      riskLevel: "MEDIUM",
      requiresApproval: false,
      readOnly: true,
      inputSchema: POSTGRES_READ_INPUT_V1,
      outputSchema: POSTGRES_READ_OUTPUT_V1,
      lifecycle: "active",
    },
  });
  registerRuntimeHandler({
    store: params.store,
    tenantId: params.tenantId,
    connectorId: "db-postgres",
    actionKey: "db.query.read",
    version: "v1",
    handlerRef: POSTGRES_READ_HANDLER_REF,
    nowIso: params.nowIso,
  });
}

export function ensurePostgresConnectorPackage(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  nowIso: string;
}): { installed: boolean; actionCount: number } {
  const existing = listConnectorActions({
    store: params.store,
    tenantId: params.tenantId,
    connectorId: "db-postgres",
  });
  if (existing.length > 0) {
    return { installed: false, actionCount: existing.length };
  }
  seedPostgresConnectorPackage(params);
  const actionCount = listConnectorActions({
    store: params.store,
    tenantId: params.tenantId,
    connectorId: "db-postgres",
  }).length;
  return { installed: true, actionCount };
}
