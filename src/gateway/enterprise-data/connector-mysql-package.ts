import { MYSQL_READ_HANDLER_REF } from "./adapters/mysql.js";
import { listConnectorActions, upsertConnectorAction } from "./connector-action-store.js";
import { registerRuntimeHandler } from "./runtime-registry.js";
import type { EnterpriseDataStore } from "./types.js";

const MYSQL_READ_OUTPUT_V1 = {
  type: "object",
  properties: {
    rows: { type: "array" },
    rowCount: { type: "number" },
  },
} as const;

const MYSQL_READ_INPUT_V1 = {
  type: "object",
  properties: {
    sql: {
      type: "string",
      description: "只读 SQL（SELECT / WITH）。留空默认执行 SELECT 1。",
    },
  },
} as const;

export function seedMysqlConnectorPackage(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  nowIso: string;
}): void {
  upsertConnectorAction({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    action: {
      connectorId: "db-mysql",
      actionKey: "db.query.read",
      version: "v1",
      displayName: "MySQL 只读查询",
      category: "external",
      // Read-only at the action level; recommend a read-only DB role at the source.
      riskLevel: "MEDIUM",
      requiresApproval: false,
      readOnly: true,
      inputSchema: MYSQL_READ_INPUT_V1,
      outputSchema: MYSQL_READ_OUTPUT_V1,
      lifecycle: "active",
    },
  });
  registerRuntimeHandler({
    store: params.store,
    tenantId: params.tenantId,
    connectorId: "db-mysql",
    actionKey: "db.query.read",
    version: "v1",
    handlerRef: MYSQL_READ_HANDLER_REF,
    nowIso: params.nowIso,
  });
}

export function ensureMysqlConnectorPackage(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  nowIso: string;
}): { installed: boolean; actionCount: number } {
  const existing = listConnectorActions({
    store: params.store,
    tenantId: params.tenantId,
    connectorId: "db-mysql",
  });
  if (existing.length > 0) {
    return { installed: false, actionCount: existing.length };
  }
  seedMysqlConnectorPackage(params);
  const actionCount = listConnectorActions({
    store: params.store,
    tenantId: params.tenantId,
    connectorId: "db-mysql",
  }).length;
  return { installed: true, actionCount };
}
