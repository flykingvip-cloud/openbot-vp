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
    actionKey: "erp.sale_delivery.query_list",
    displayName: "销货单列表",
    handlerRef: "enterprise-data/handlers/yonyou-tplus-sale-delivery-list-v1",
  },
  {
    actionKey: "erp.doc.query",
    displayName: "凭证查询",
    handlerRef: "enterprise-data/handlers/yonyou-tplus-doc-query-v1",
  },
] as const;

function installYonyouTplusActions(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  nowIso: string;
  actions: readonly (typeof ACTIONS)[number][];
}): void {
  for (const action of params.actions) {
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

export function seedYonyouTplusConnectorPackage(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  nowIso: string;
}): void {
  installYonyouTplusActions({ ...params, actions: ACTIONS });
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
  const existingKeys = new Set(existing.map((action) => action.actionKey));
  const missing = ACTIONS.filter((action) => !existingKeys.has(action.actionKey));
  if (missing.length === 0) {
    return { installed: false, actionCount: existing.length };
  }
  installYonyouTplusActions({ ...params, actions: missing });
  return { installed: true, actionCount: existing.length + missing.length };
}
