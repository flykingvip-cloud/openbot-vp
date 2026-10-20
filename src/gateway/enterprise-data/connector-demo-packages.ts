import { upsertConnectorAction } from "./connector-action-store.js";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import { listConnectorActions } from "./connector-action-store.js";
import { assertKnownDataConnector } from "./connector-catalog.js";
import { registerRuntimeHandler } from "./runtime-registry.js";
import type { EnterpriseDataStore } from "./types.js";

const CUSTOMER_SUMMARY_OUTPUT_V1 = {
  type: "object",
  properties: {
    customer: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
      },
    },
  },
} as const;

const CUSTOMER_SUMMARY_OUTPUT_V2 = {
  type: "object",
  properties: {
    customer: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        segment: { type: "string" },
      },
    },
  },
} as const;

function seedCrmSalesforceDemoPackage(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  nowIso: string;
}): void {
  upsertConnectorAction({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    action: {
      connectorId: "crm-salesforce",
      actionKey: "crm.customer.read_summary",
      version: "v1",
      displayName: "客户摘要查询",
      category: "crm",
      riskLevel: "LOW",
      requiresApproval: false,
      readOnly: true,
      outputSchema: CUSTOMER_SUMMARY_OUTPUT_V1,
      lifecycle: "active",
    },
  });
  upsertConnectorAction({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    action: {
      connectorId: "crm-salesforce",
      actionKey: "crm.customer.read_summary",
      version: "v2",
      displayName: "客户摘要查询（含细分）",
      category: "crm",
      riskLevel: "LOW",
      requiresApproval: false,
      readOnly: true,
      outputSchema: CUSTOMER_SUMMARY_OUTPUT_V2,
      lifecycle: "active",
    },
  });
  upsertConnectorAction({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    action: {
      connectorId: "crm-salesforce",
      actionKey: "crm.customer.export",
      version: "v1",
      displayName: "客户导出",
      category: "crm",
      riskLevel: "HIGH",
      requiresApproval: true,
      readOnly: true,
      outputSchema: { type: "array", items: CUSTOMER_SUMMARY_OUTPUT_V1 },
      lifecycle: "active",
    },
  });
  registerRuntimeHandler({
    store: params.store,
    tenantId: params.tenantId,
    connectorId: "crm-salesforce",
    actionKey: "crm.customer.read_summary",
    version: "v1",
    handlerRef: "enterprise-data/handlers/crm-customer-read-summary-v1",
    nowIso: params.nowIso,
  });
  registerRuntimeHandler({
    store: params.store,
    tenantId: params.tenantId,
    connectorId: "crm-salesforce",
    actionKey: "crm.customer.read_summary",
    version: "v2",
    handlerRef: "enterprise-data/handlers/crm-customer-read-summary-v2",
    nowIso: params.nowIso,
  });
  registerRuntimeHandler({
    store: params.store,
    tenantId: params.tenantId,
    connectorId: "crm-salesforce",
    actionKey: "crm.customer.export",
    version: "v1",
    handlerRef: "enterprise-data/handlers/crm-customer-export-v1",
    nowIso: params.nowIso,
  });
}

function seedErpSapDemoPackage(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  nowIso: string;
}): void {
  upsertConnectorAction({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    action: {
      connectorId: "erp-sap",
      actionKey: "erp.order.read_status",
      version: "v1",
      displayName: "订单状态查询",
      category: "erp",
      riskLevel: "LOW",
      requiresApproval: false,
      readOnly: true,
      outputSchema: {
        type: "object",
        properties: {
          order: {
            type: "object",
            properties: {
              id: { type: "string" },
              status: { type: "string" },
            },
          },
        },
      },
      lifecycle: "active",
    },
  });
  registerRuntimeHandler({
    store: params.store,
    tenantId: params.tenantId,
    connectorId: "erp-sap",
    actionKey: "erp.order.read_status",
    version: "v1",
    handlerRef: "enterprise-data/handlers/erp-order-read-status-v1",
    nowIso: params.nowIso,
  });
}

export function ensureConnectorDemoPackage(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  connectorId: string;
  nowIso: string;
}): { installed: boolean; actionCount: number } {
  const definition = assertKnownDataConnector(params.connectorId);
  if (definition.integrationTier !== "demo") {
    throw new EnterpriseDataStoreError(
      "CONNECTOR_DEMO_PACKAGE_UNSUPPORTED",
      `Connector ${params.connectorId} does not support demo package installation.`,
    );
  }
  const existing = listConnectorActions({
    store: params.store,
    tenantId: params.tenantId,
    connectorId: definition.connectorId,
  });
  if (existing.length > 0) {
    return { installed: false, actionCount: existing.length };
  }
  if (definition.connectorId === "crm-salesforce") {
    seedCrmSalesforceDemoPackage(params);
  } else if (definition.connectorId === "erp-sap") {
    seedErpSapDemoPackage(params);
  } else {
    throw new EnterpriseDataStoreError(
      "CONNECTOR_DEMO_PACKAGE_MISSING",
      `No demo package seed for ${definition.connectorId}.`,
    );
  }
  const actionCount = listConnectorActions({
    store: params.store,
    tenantId: params.tenantId,
    connectorId: definition.connectorId,
  }).length;
  return { installed: true, actionCount };
}
