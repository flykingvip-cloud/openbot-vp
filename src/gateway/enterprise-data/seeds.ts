import { upsertApprovalPolicy } from "./approval-policy-store.js";
import { upsertConnectorAction } from "./connector-action-store.js";
import { upsertDataAccessPolicy, compileDataAccessPolicy } from "./data-access-policy-store.js";
import { upsertDataCapability } from "./data-capability-store.js";
import { upsertDataSource } from "./data-source-store.js";
import { MATERIALIZER_SEAT_ID } from "./enterprise-data-seat-context.js";
import { upsertEnterpriseKnowledgeProjectionBinding } from "./enterprise-knowledge-projection-binding-store.js";
import {
  ensureClassificationRuntimeConfig,
  upsertFieldClassification,
  upsertMaskingPolicy,
} from "./field-classification-store.js";
import { upsertKnowledgeVisibilityPolicy } from "./knowledge-visibility-policy-store.js";
import { upsertEnterpriseKnowledgeProjectionSpec } from "./projection-spec-store.js";
import { registerRuntimeHandler } from "./runtime-registry.js";
import { upsertScopePolicy } from "./scope-policy-store.js";
import { upsertSeatActionGrant } from "./seat-action-grant-store.js";
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

export function seedEnterpriseDataCatalog(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  nowIso: string;
}): EnterpriseDataStore {
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

  const crmSource = upsertDataSource({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    source: {
      sourceKey: "crm-salesforce",
      displayName: "Salesforce CRM",
      category: "crm",
      status: "connected",
      connectorId: "crm-salesforce",
    },
  });
  const erpSource = upsertDataSource({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    source: {
      sourceKey: "erp-sap",
      displayName: "SAP ERP",
      category: "erp",
      status: "connected",
      connectorId: "erp-sap",
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
  registerRuntimeHandler({
    store: params.store,
    tenantId: params.tenantId,
    connectorId: "erp-sap",
    actionKey: "erp.order.read_status",
    version: "v1",
    handlerRef: "enterprise-data/handlers/erp-order-read-status-v1",
    nowIso: params.nowIso,
  });

  const customerCapability = upsertDataCapability({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    capability: {
      capabilityKey: "customer.profile",
      seedOrigin: "demo",
      displayName: "客户画像能力",
      description: "从 CRM 客户摘要构建客户画像",
      sourceIds: [crmSource.sourceId],
      actionRefs: [
        {
          connectorId: "crm-salesforce",
          actionKey: "crm.customer.read_summary",
          version: "v1",
        },
      ],
      enabled: true,
    },
  });
  const churnCapability = upsertDataCapability({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    capability: {
      capabilityKey: "sales.churn-risk",
      seedOrigin: "demo",
      displayName: "客户流失风险能力",
      description: "基于 CRM v2 客户细分生成流失风险洞察",
      sourceIds: [crmSource.sourceId],
      actionRefs: [
        {
          connectorId: "crm-salesforce",
          actionKey: "crm.customer.read_summary",
          version: "v2",
        },
      ],
      enabled: true,
    },
  });
  upsertDataCapability({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    capability: {
      capabilityKey: "order.status",
      seedOrigin: "demo",
      displayName: "订单状态能力",
      description: "从 ERP 查询订单状态",
      sourceIds: [erpSource.sourceId],
      actionRefs: [
        {
          connectorId: "erp-sap",
          actionKey: "erp.order.read_status",
          version: "v1",
        },
      ],
      enabled: true,
    },
  });

  const profileProjection = upsertEnterpriseKnowledgeProjectionSpec({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    spec: {
      projectionKey: "customer.profile",
      displayName: "客户画像",
      category: "customer",
      capabilityId: customerCapability.capabilityId,
      sourceActions: [
        {
          connectorId: "crm-salesforce",
          actionKey: "crm.customer.read_summary",
          version: "v1",
        },
      ],
      objectKind: "data",
      templateKey: "NormalizeTemplate",
      description: "从 CRM 客户摘要规范化为知识宇宙可消费的客户画像对象",
      outputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          kind: { type: "string" },
          payload: { type: "object" },
        },
      },
      lifecycle: "active",
    },
  });
  const churnProjection = upsertEnterpriseKnowledgeProjectionSpec({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    spec: {
      projectionKey: "sales.churn-risk",
      displayName: "客户流失风险洞察",
      category: "sales",
      capabilityId: churnCapability.capabilityId,
      sourceActions: [
        {
          connectorId: "crm-salesforce",
          actionKey: "crm.customer.read_summary",
          version: "v2",
        },
      ],
      objectKind: "insight",
      templateKey: "RiskDetectionTemplate",
      description: "基于客户细分字段生成流失风险洞察",
      outputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          riskScore: { type: "number" },
        },
      },
      // Active so scheduled materialization can refresh this projection in demos/tests.
      lifecycle: "active",
    },
  });

  const profileVisibility = upsertKnowledgeVisibilityPolicy({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    policy: {
      projectionId: profileProjection.projectionId,
      visibleSeats: ["seat-sales-director", "seat-sales-mgr-east"],
      visibleTeams: ["华东销售"],
      visibleDepartments: ["sales-mgr:华东销售"],
      visibleRoles: ["sales-mgr"],
      visibleAgentTypes: ["employee-agent"],
    },
  });
  upsertEnterpriseKnowledgeProjectionBinding({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    binding: {
      projectionId: profileProjection.projectionId,
      capabilityId: customerCapability.capabilityId,
      materializationMode: "on_demand",
      materializationTeamLabel: "华东销售",
      freshnessSlaMinutes: 60,
      enabled: true,
      generatorVersion: "1.0.0",
      visibilityPolicyId: profileVisibility.policyId,
    },
  });
  upsertEnterpriseKnowledgeProjectionBinding({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    binding: {
      projectionId: churnProjection.projectionId,
      capabilityId: churnCapability.capabilityId,
      materializationMode: "scheduled",
      materializationTeamLabel: "华东销售",
      freshnessSlaMinutes: 240,
      enabled: true,
      generatorVersion: "1.0.0",
    },
  });

  upsertScopePolicy({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    policy: {
      scopePolicyId: "scope-self-default",
      displayName: "本人数据范围",
      scopeType: "SELF",
      filterClauses: [{ field: "customer.owner_id", operator: "eq", valueRef: "current_user.id" }],
      filterDescription: "仅可访问本人负责的客户",
    },
  });
  upsertScopePolicy({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    policy: {
      scopePolicyId: "scope-team-default",
      displayName: "团队数据范围",
      scopeType: "TEAM",
      filterClauses: [
        { field: "customer.owner_team", operator: "eq", valueRef: "current_user.team" },
      ],
      filterDescription: "可访问本团队客户",
    },
  });
  upsertScopePolicy({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    policy: {
      scopePolicyId: "scope-all-readonly",
      displayName: "全量只读范围",
      scopeType: "ALL",
      filterDescription: "租户内全量只读（需额外审批）",
    },
  });

  const phoneMask = upsertMaskingPolicy({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    policy: {
      maskingPolicyId: "mask-partial-phone",
      displayName: "手机号部分脱敏",
      strategy: "partial_phone",
    },
  });
  upsertMaskingPolicy({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    policy: {
      maskingPolicyId: "mask-partial-email",
      displayName: "邮箱部分脱敏",
      strategy: "partial_email",
    },
  });
  ensureClassificationRuntimeConfig({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
  });

  const v1Fields: Array<{
    fieldPath: string;
    classification: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
    maskingPolicyId?: string;
    blockDetail?: boolean;
  }> = [
    { fieldPath: "customer.id", classification: "PUBLIC" },
    { fieldPath: "customer.name", classification: "INTERNAL" },
    {
      fieldPath: "customer.phone",
      classification: "CONFIDENTIAL",
      maskingPolicyId: phoneMask.maskingPolicyId,
    },
    {
      fieldPath: "customer.email",
      classification: "CONFIDENTIAL",
      maskingPolicyId: "mask-partial-email",
    },
  ];
  for (const field of v1Fields) {
    upsertFieldClassification({
      store: params.store,
      tenantId: params.tenantId,
      nowIso: params.nowIso,
      classification: {
        connectorId: "crm-salesforce",
        actionKey: "crm.customer.read_summary",
        version: "v1",
        ...field,
      },
    });
  }
  for (const field of [
    ...v1Fields,
    { fieldPath: "customer.segment", classification: "INTERNAL" as const },
  ]) {
    upsertFieldClassification({
      store: params.store,
      tenantId: params.tenantId,
      nowIso: params.nowIso,
      classification: {
        connectorId: "crm-salesforce",
        actionKey: "crm.customer.read_summary",
        version: "v2",
        ...field,
      },
    });
  }

  // ERP order-status fields: classify so governed reads (mock or live SAP adapter)
  // return usable values instead of fail-closed redaction. PUBLIC/INTERNAL are not
  // masked; bump to CONFIDENTIAL + a masking policy if a field becomes sensitive.
  for (const field of [
    { fieldPath: "order.id", classification: "PUBLIC" as const },
    { fieldPath: "order.status", classification: "INTERNAL" as const },
    { fieldPath: "order.created_by", classification: "INTERNAL" as const },
    { fieldPath: "order.team_id", classification: "INTERNAL" as const },
  ]) {
    upsertFieldClassification({
      store: params.store,
      tenantId: params.tenantId,
      nowIso: params.nowIso,
      classification: {
        connectorId: "erp-sap",
        actionKey: "erp.order.read_status",
        version: "v1",
        ...field,
      },
    });
  }

  upsertApprovalPolicy({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    policy: {
      approvalPolicyId: "policy-none-default",
      displayName: "无需审批",
      mode: "NONE",
      approverRole: "enterprise-admin",
    },
  });
  upsertApprovalPolicy({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    policy: {
      approvalPolicyId: "policy-export-per-request",
      displayName: "导出每次审批",
      mode: "PER_REQUEST",
      approverRole: "enterprise-admin",
    },
  });
  upsertApprovalPolicy({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    policy: {
      approvalPolicyId: "policy-batch-once-24h",
      displayName: "批量查询一次性审批（24h）",
      mode: "ONCE",
      approverRole: "enterprise-admin",
      expiryHours: 24,
    },
  });

  const accessPolicy = upsertDataAccessPolicy({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    policy: {
      displayName: "销售经理客户摘要访问",
      targetKind: "seat",
      targetId: "seat-sales-mgr-east",
      sourceId: crmSource.sourceId,
      actionRefs: [
        {
          connectorId: "crm-salesforce",
          actionKey: "crm.customer.read_summary",
          version: "v1",
        },
      ],
      scopePolicyId: "scope-self-default",
      approvalPolicyId: "policy-none-default",
      enabled: true,
    },
  });
  compileDataAccessPolicy({
    store: params.store,
    tenantId: params.tenantId,
    policyId: accessPolicy.policyId,
    nowIso: params.nowIso,
  });

  upsertDataAccessPolicy({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    policy: {
      displayName: "销售部门客户摘要访问",
      targetKind: "department",
      targetId: "sales-mgr:华东销售",
      sourceId: crmSource.sourceId,
      actionRefs: [
        {
          connectorId: "crm-salesforce",
          actionKey: "crm.customer.read_summary",
          version: "v1",
        },
      ],
      scopePolicyId: "scope-team-default",
      approvalPolicyId: "policy-none-default",
      enabled: true,
    },
  });
  upsertDataAccessPolicy({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    policy: {
      displayName: "销售经理角色客户摘要访问",
      targetKind: "role",
      targetId: "sales-mgr",
      sourceId: crmSource.sourceId,
      actionRefs: [
        {
          connectorId: "crm-salesforce",
          actionKey: "crm.customer.read_summary",
          version: "v1",
        },
      ],
      scopePolicyId: "scope-team-default",
      approvalPolicyId: "policy-none-default",
      enabled: true,
    },
  });

  upsertSeatActionGrant({
    store: params.store,
    tenantId: params.tenantId,
    seatId: "seat-sales-director",
    connectorId: "crm-salesforce",
    actionKey: "crm.customer.read_summary",
    version: "v1",
    scopePolicyId: "scope-team-default",
    approvalPolicyId: "policy-none-default",
    nowIso: params.nowIso,
  });
  upsertSeatActionGrant({
    store: params.store,
    tenantId: params.tenantId,
    seatId: "seat-sales-director",
    connectorId: "crm-salesforce",
    actionKey: "crm.customer.export",
    version: "v1",
    scopePolicyId: "scope-team-default",
    approvalPolicyId: "policy-export-per-request",
    nowIso: params.nowIso,
  });
  upsertSeatActionGrant({
    store: params.store,
    tenantId: params.tenantId,
    seatId: MATERIALIZER_SEAT_ID,
    connectorId: "crm-salesforce",
    actionKey: "crm.customer.read_summary",
    version: "v1",
    scopePolicyId: "scope-team-default",
    approvalPolicyId: "policy-none-default",
    nowIso: params.nowIso,
  });
  upsertSeatActionGrant({
    store: params.store,
    tenantId: params.tenantId,
    seatId: MATERIALIZER_SEAT_ID,
    connectorId: "crm-salesforce",
    actionKey: "crm.customer.read_summary",
    version: "v2",
    scopePolicyId: "scope-team-default",
    approvalPolicyId: "policy-none-default",
    nowIso: params.nowIso,
  });

  return params.store;
}

/**
 * Whether empty tenant stores should receive the Salesforce/SAP demo catalog.
 *
 * Shared multi-tenant (OPENBOT_MULTITENANT=1) must NOT auto-seed: each new
 * enterprise starts empty and is configured by its own admins. Local/single-tenant
 * still seeds for developer ergonomics and existing unit tests.
 */
function shouldAutoSeedDemoCatalogForEmptyTenant(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.OPENBOT_MULTITENANT?.trim() || env.OPENCLAW_MULTITENANT?.trim();
  if (flag === "1" || flag?.toLowerCase() === "true") {
    return false;
  }
  return true;
}

export function ensureEnterpriseDataCatalogSeeded(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  nowIso: string;
}): EnterpriseDataStore {
  const hasTenantActions = Object.values(params.store.connectorActions).some(
    (action) => action.tenantId === params.tenantId,
  );
  if (hasTenantActions) {
    return params.store;
  }
  if (!shouldAutoSeedDemoCatalogForEmptyTenant()) {
    return params.store;
  }
  return seedEnterpriseDataCatalog(params);
}
