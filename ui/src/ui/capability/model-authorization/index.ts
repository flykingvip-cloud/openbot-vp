/**
 * 模型授权（Model Authorization）能力模块 barrel。
 *
 * 设计：`.kiro/specs/model-entitlement-chain/design.md`（§8.2 三端拆分）。
 * 供企业端授权操作面（任务 11）与员工端只读可用模型（任务 12）消费。
 */

export type {
  EmployeeModelEntitlementSummary,
  EnterpriseModelEntitlement,
  EntitlementResolutionState,
  ModelGrantSubjectType,
  ModelQuota,
  ModelRef,
  PlanModelAorExecution,
  PlanVersionModelBinding,
  SeatModelGrant,
} from "./types.ts";

export type {
  BindingGetRequest,
  BindingGetResponse,
  BindingListRequest,
  BindingListResponse,
  BindingSetRequest,
  BindingSetResponse,
  EmployeeSummaryRequest,
  EmployeeSummaryResponse,
  GrantListRequest,
  GrantListResponse,
  GrantRequest,
  GrantResponse,
  GrantScope,
  ModelAuthorizationEndpoint,
  RevokeRequest,
  RevokeResponse,
} from "./endpoints.ts";

export { MODEL_AUTHORIZATION_ENDPOINTS } from "./endpoints.ts";

export {
  createModelAuthorizationGateway,
  type ModelAuthorizationGateway,
} from "./gateway-client.ts";

export {
  buildEmployeeModelUsageView,
  buildEmployeeModelView,
  buildEnterpriseAuthorizationView,
  type EmployeeModelUsageRow,
  type EmployeeModelUsageView,
  type EmployeeModelView,
  type EnterpriseAuthorizationView,
  type EnterpriseGrantSubjectView,
  type ModelGrantRow,
  type ModelUsageInputRow,
} from "./view-model.ts";

export { getModelAuthorizationClient, setModelAuthorizationClient } from "./client-singleton.ts";
