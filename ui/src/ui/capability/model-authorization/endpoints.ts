/**
 * 模型授权 RPC 端点定义（Request/Response 契约）。
 *
 * 对应网关 handler：`src/gateway/server-methods/model-entitlement-management.ts`
 * - 平台侧 `platform-model-binding.*`：维护 planVersion → allowedModelIds(+额度/AOR)
 * - 企业侧 `enterprise-model-grant.*`：对 seat/employee 授予/撤销模型（越权被拒）
 *
 * 仅 `type` 别名；类型从 `./types.ts` 引入。
 */

import type {
  EmployeeModelEntitlementSummary,
  EnterpriseModelEntitlement,
  ModelGrantSubjectType,
  ModelQuota,
  ModelRef,
  PlanModelAorExecution,
  PlanVersionModelBinding,
  SeatModelGrant,
} from "./types.ts";

/** 规范化 RPC 方法名常量。 */
export const MODEL_AUTHORIZATION_ENDPOINTS = {
  bindingSet: "platform-model-binding.set",
  bindingGet: "platform-model-binding.get",
  bindingList: "platform-model-binding.list",
  grantGrant: "enterprise-model-grant.grant",
  grantGrantBatch: "enterprise-model-grant.grantBatch",
  grantRevoke: "enterprise-model-grant.revoke",
  grantList: "enterprise-model-grant.list",
  employeeSummary: "employee-model-access.summary",
} as const;

export type ModelAuthorizationEndpoint =
  (typeof MODEL_AUTHORIZATION_ENDPOINTS)[keyof typeof MODEL_AUTHORIZATION_ENDPOINTS];

// ── 平台侧 platform-model-binding.* ─────────────────────────────────────────

export type BindingSetRequest = {
  planVersionId: string;
  allowedModelIds: ModelRef[];
  modelQuota?: ModelQuota;
  aorExecution?: PlanModelAorExecution;
};

export type BindingSetResponse = {
  binding: PlanVersionModelBinding;
};

export type BindingGetRequest = {
  planVersionId: string;
};

export type BindingGetResponse = {
  binding: PlanVersionModelBinding | null;
};

export type BindingListRequest = Record<string, never>;

export type BindingListResponse = {
  bindings: PlanVersionModelBinding[];
};

// ── 企业侧 enterprise-model-grant.* ─────────────────────────────────────────

/** 授权/撤销作用域：企业租户由调用方身份解析（可选显式 tenantId 回退）。 */
export type GrantScope = {
  tenantId?: string;
  enterpriseId?: string;
};

export type GrantRequest = GrantScope & {
  subjectType: ModelGrantSubjectType;
  subjectId: string;
  seatId?: string;
  employeeId?: string;
  grantedModelIds: ModelRef[];
  /** `union` merges into existing active grant; default `replace`. */
  mergeMode?: "replace" | "union";
};

export type GrantResponse = {
  grant: SeatModelGrant;
};

export type GrantBatchRequest = GrantScope & {
  mergeMode?: "replace" | "union";
  grants: Array<{
    subjectType: ModelGrantSubjectType;
    subjectId: string;
    seatId?: string;
    employeeId?: string;
    grantedModelIds: ModelRef[];
    mergeMode?: "replace" | "union";
  }>;
};

export type GrantBatchResponse = {
  grants: SeatModelGrant[];
};

export type RevokeRequest = GrantScope & {
  subjectType: ModelGrantSubjectType;
  subjectId: string;
};

export type RevokeResponse = {
  grant: SeatModelGrant | null;
};

export type GrantListRequest = GrantScope;

export type GrantListResponse = {
  entitlement: EnterpriseModelEntitlement | null;
  allowedModelIds: ModelRef[];
  ceilingModelIds?: ModelRef[];
  subscriptionModelIds?: ModelRef[];
  tenantOwnedModelIds?: ModelRef[];
  /** 套餐或已授权记录里未连通的平台模型，企业列表不渲染。 */
  suppressedPlatformModelIds?: ModelRef[];
  /** 企业自供连接失败、资产不健康，或授权指向已删除的运行时模型。 */
  unusableModels?: Array<{
    kind: "connection" | "asset" | "grant";
    id: string;
    title: string;
    detail: string;
    modelId?: string;
    connectionId?: string;
  }>;
  grants: SeatModelGrant[];
};

// ── 员工侧 employee-model-entitlement.* ─────────────────────────────────────

export type EmployeeSummaryRequest = Record<string, never>;

export type EmployeeSummaryResponse = {
  summary: EmployeeModelEntitlementSummary;
};
