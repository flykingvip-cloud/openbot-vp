import { YONYOU_TPLUS_CONNECTOR_ID } from "./adapters/yonyou-tplus-oauth.js";
import { listConnectorActions, upsertConnectorAction } from "./connector-action-store.js";
import { registerRuntimeHandler } from "./runtime-registry.js";
import type { EnterpriseDataStore } from "./types.js";

const RECORD_OUTPUT = {
  type: "object",
  properties: {
    records: {},
  },
} as const;

const ACTIONS = [
  {
    actionKey: "erp.account.read_version",
    displayName: "账套版本",
    handlerRef: "enterprise-data/handlers/yonyou-tplus-account-version-v1",
  },
  {
    actionKey: "erp.warehouse.query",
    displayName: "仓库查询",
    handlerRef: "enterprise-data/handlers/yonyou-tplus-warehouse-query-v1",
  },
  {
    actionKey: "erp.inventory.query_page",
    displayName: "存货分页查询",
    handlerRef: "enterprise-data/handlers/yonyou-tplus-inventory-query-page-v1",
  },
  {
    actionKey: "erp.partner.query_page",
    displayName: "往来单位分页查询",
    handlerRef: "enterprise-data/handlers/yonyou-tplus-partner-query-page-v1",
  },
  {
    actionKey: "erp.sale_order.query_list",
    displayName: "销售订单列表",
    handlerRef: "enterprise-data/handlers/yonyou-tplus-sale-order-list-v1",
  },
  {
    actionKey: "erp.doc.query",
    displayName: "凭证查询",
    handlerRef: "enterprise-data/handlers/yonyou-tplus-doc-query-v1",
  },
] as const;

export function seedYonyouTplusConnectorPackage(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  nowIso: string;
}): void {
  for (const action of ACTIONS) {
    upsertConnectorAction({
      store: params.store,
      tenantId: params.tenantId,
      nowIso: params.nowIso,
      action: {
        connectorId: YONYOU_TPLUS_CONNECTOR_ID,
        actionKey: action.actionKey,
        version: "v1",
        displayName: action.displayName,
        category: "erp",
        riskLevel: "LOW",
        requiresApproval: false,
        readOnly: true,
        outputSchema: RECORD_OUTPUT,
        lifecycle: "active",
      },
    });
    registerRuntimeHandler({
      store: params.store,
      tenantId: params.tenantId,
      connectorId: YONYOU_TPLUS_CONNECTOR_ID,
      actionKey: action.actionKey,
      version: "v1",
      handlerRef: action.handlerRef,
      nowIso: params.nowIso,
    });
  }
}

export function ensureYonyouTplusConnectorPackage(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  nowIso: string;
}): { installed: boolean; actionCount: number } {
  const existing = listConnectorActions({
    store: params.store,
    tenantId: params.tenantId,
    connectorId: YONYOU_TPLUS_CONNECTOR_ID,
  });
  if (existing.length > 0) {
    return { installed: false, actionCount: existing.length };
  }
  seedYonyouTplusConnectorPackage(params);
  const actionCount = listConnectorActions({
    store: params.store,
    tenantId: params.tenantId,
    connectorId: YONYOU_TPLUS_CONNECTOR_ID,
  }).length;
  return { installed: true, actionCount };
}
