import { YONYOU_TPLUS_CONNECTOR_ID } from "./adapters/yonyou-tplus-oauth.js";
import { listConnectorActions, upsertConnectorAction } from "./connector-action-store.js";
import { MATERIALIZER_SEAT_ID } from "./enterprise-data-seat-context.js";
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

export function seedYonyouTplusConnectorPackage(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  nowIso: string;
}): void {
  installYonyouTplusActions({ ...params, actions: ACTIONS });
  ensureMaterializerSeatGrants(params);
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
  return {
    installed: missing.length > 0,
    actionCount: existing.length + missing.length,
  };
}
