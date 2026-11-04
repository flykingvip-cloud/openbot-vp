import { YONYOU_TPLUS_CONNECTOR_ID } from "./adapters/yonyou-tplus-oauth.js";
import { listConnectorActions, upsertConnectorAction } from "./connector-action-store.js";
import { MATERIALIZER_SEAT_ID } from "./enterprise-data-seat-context.js";
import { upsertFieldClassification } from "./field-classification-store.js";
import { registerRuntimeHandler } from "./runtime-registry.js";
import { findScopePolicy, upsertScopePolicy } from "./scope-policy-store.js";
import { findSeatActionGrant, upsertSeatActionGrant } from "./seat-action-grant-store.js";
import type { EnterpriseDataStore, ScopePolicy } from "./types.js";

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
    actionKey: "erp.purchase_receive.query_list",
    displayName: "采购入库单列表",
    handlerRef: "enterprise-data/handlers/yonyou-tplus-purchase-receive-list-v1",
  },
  {
    actionKey: "erp.current_stock.query",
    displayName: "现存量查询",
    handlerRef: "enterprise-data/handlers/yonyou-tplus-current-stock-query-v1",
  },
  {
    actionKey: "erp.doc.query",
    displayName: "凭证查询",
    handlerRef: "enterprise-data/handlers/yonyou-tplus-doc-query-v1",
  },
] as const;

/** Same ids as the Salesforce catalog seed. Created only when this tenant has none. */
const MATERIALIZER_SCOPE_TEAM_ID = "scope-team-default";
const MATERIALIZER_SCOPE_SELF_ID = "scope-self-default";

const DEFAULT_SCOPE_POLICIES: Array<
  Pick<
    ScopePolicy,
    "scopePolicyId" | "displayName" | "scopeType" | "filterClauses" | "filterDescription"
  >
> = [
  {
    scopePolicyId: MATERIALIZER_SCOPE_SELF_ID,
    displayName: "本人数据范围",
    scopeType: "SELF",
    filterClauses: [{ field: "customer.owner_id", operator: "eq", valueRef: "current_user.id" }],
    filterDescription: "仅可访问本人负责的客户",
  },
  {
    scopePolicyId: MATERIALIZER_SCOPE_TEAM_ID,
    displayName: "团队数据范围",
    scopeType: "TEAM",
    filterClauses: [
      { field: "customer.owner_team", operator: "eq", valueRef: "current_user.team" },
    ],
    filterDescription: "可访问本团队客户",
  },
];

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

/**
 * `projection-materializer.run` always executes as {@link MATERIALIZER_SEAT_ID}.
 * That seat is not on the org chart, so Control UI 权限与治理 and
 * `capabilities.grant-seat` cannot authorize it. Package install is the path
 * that writes the seat action grants (same upsert the Salesforce seed uses).
 *
 * Read-only actions omit `approvalPolicyId`. An active grant is left as-is so
 * a later ensure-package does not reset an admin-chosen scope.
 */
function ensureMaterializerSeatGrants(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  nowIso: string;
}): void {
  for (const policy of DEFAULT_SCOPE_POLICIES) {
    if (findScopePolicy(params.store, params.tenantId, policy.scopePolicyId)) {
      continue;
    }
    upsertScopePolicy({
      store: params.store,
      tenantId: params.tenantId,
      nowIso: params.nowIso,
      policy,
    });
  }
  for (const action of ACTIONS) {
    const ref = {
      connectorId: YONYOU_TPLUS_CONNECTOR_ID,
      actionKey: action.actionKey,
      version: "v1",
    };
    if (findSeatActionGrant(params.store, params.tenantId, MATERIALIZER_SEAT_ID, ref)) {
      continue;
    }
    upsertSeatActionGrant({
      store: params.store,
      tenantId: params.tenantId,
      seatId: MATERIALIZER_SEAT_ID,
      ...ref,
      scopePolicyId: MATERIALIZER_SCOPE_TEAM_ID,
      nowIso: params.nowIso,
    });
  }
}

/**
 * Business identity / list-display fields that authorized enterprise seats may
 * read in plaintext. Unknown scalars still fail_closed_redact to "***" (phones,
 * bank accounts, id numbers, etc. stay masked unless explicitly classified).
 * Paths use `records[*].…` wildcards (see resolveClassificationForPath).
 */
const YONYOU_PUBLIC_FIELDS_BY_ACTION: Record<string, readonly string[]> = {
  "erp.warehouse.query": ["Code", "Name", "ID"],
  // Inventory QueryPage: identity + cost/price (phones/bank still fail_closed).
  "erp.inventory.query_page": [
    "Code",
    "Name",
    "ID",
    "Specification",
    "InvSCost",
    "LatestCost",
    "AvagCost",
    "RetailPriceNew",
  ],
  // Partner QueryPage SelectFields include PartnerType.*; nest under records[*].
  "erp.partner.query_page": ["Code", "Name", "ID", "PartnerType.Code", "PartnerType.Name"],
  // Voucher Rows keys strip SaleDelivery./SaleOrder. root (see yonyouTplusSelectFieldPathKey).
  "erp.sale_delivery.query_list": [
    "Code",
    "Name",
    "ID",
    "VoucherDate",
    "Customer.Code",
    "Customer.Name",
    "Warehouse.Code",
    "Warehouse.Name",
    "SaleDeliveryDetails.Inventory.Code",
    "SaleDeliveryDetails.Inventory.Name",
    "SaleDeliveryDetails.Quantity",
    "SaleDeliveryDetails.OrigTaxPrice",
    "SaleDeliveryDetails.OrigTaxAmount",
  ],
  "erp.sale_order.query_list": [
    "Code",
    "Name",
    "ID",
    "VoucherDate",
    "Customer.Code",
    "Customer.Name",
    "SaleOrderDetails.Inventory.Code",
    "SaleOrderDetails.Inventory.Name",
    "SaleOrderDetails.Quantity",
    "SaleOrderDetails.OrigTaxPrice",
    "SaleOrderDetails.OrigTaxAmount",
  ],
  // PurchaseReceive FindVoucherList strips RDRecord. root (see yonyouTplusSelectFieldPathKey).
  "erp.purchase_receive.query_list": [
    "Code",
    "Name",
    "ID",
    "VoucherDate",
    "Partner.Code",
    "Partner.Name",
    "Warehouse.Code",
    "Warehouse.Name",
    "RDRecordDetails.Inventory.Code",
    "RDRecordDetails.Inventory.Name",
    "RDRecordDetails.Quantity",
    "RDRecordDetails.OrigTaxPrice",
    "RDRecordDetails.OrigTaxAmount",
  ],
  // currentStock/Query documented response fields (no SelectFields / no nesting).
  "erp.current_stock.query": [
    "WarehouseCode",
    "WarehouseName",
    "InventoryCode",
    "InventoryName",
    "Specification",
    "UnitName",
    "AvailableQuantity",
    "ExistingQuantity",
  ],
};

/**
 * Mark list-row business fields PUBLIC so fail_closed_redact does not turn
 * simulated/live partner / voucher rows into "***" while warehouse/inventory
 * already stay plaintext after #228.
 */
function ensureYonyouTplusFieldClassifications(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  nowIso: string;
}): void {
  for (const [actionKey, fields] of Object.entries(YONYOU_PUBLIC_FIELDS_BY_ACTION)) {
    for (const field of fields) {
      upsertFieldClassification({
        store: params.store,
        tenantId: params.tenantId,
        nowIso: params.nowIso,
        classification: {
          connectorId: YONYOU_TPLUS_CONNECTOR_ID,
          actionKey,
          version: "v1",
          fieldPath: `records[*].${field}`,
          classification: "PUBLIC",
        },
      });
    }
  }
}

export function seedYonyouTplusConnectorPackage(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  nowIso: string;
}): void {
  installYonyouTplusActions({ ...params, actions: ACTIONS });
  ensureMaterializerSeatGrants(params);
  ensureYonyouTplusFieldClassifications(params);
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
  if (missing.length > 0) {
    installYonyouTplusActions({ ...params, actions: missing });
  }
  // Grants run even when every action is already registered, so a tenant that
  // installed the package before this seed can repair 立即物化 by re-running
  // ensure-package. upsert is skipped when an active grant already exists.
  ensureMaterializerSeatGrants(params);
  ensureYonyouTplusFieldClassifications(params);
  return {
    installed: missing.length > 0,
    actionCount: existing.length + missing.length,
  };
}
