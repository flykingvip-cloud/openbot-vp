/**
 * 平台「套餐⇄模型」RPC 端点（legacy）。
 *
 * @deprecated 请使用 `platform-plan-bundle.overview` / `platform-plan-bundle.update`。
 */

import type {
  ModelRef,
  PlanModelAorExecution,
  PlanModelQuotaEntry,
  PlatformModelBindingOverview,
} from "./types.ts";

export const PLATFORM_MODEL_BINDING_ENDPOINTS = {
  overview: "platform-model-binding.overview",
  set: "platform-model-binding.set",
} as const;

export type OverviewRequest = Record<string, never>;
export type OverviewResponse = PlatformModelBindingOverview;

export type BindingSetRequest = {
  planVersionId: string;
  allowedModelIds: ModelRef[];
  modelQuota?: Record<string, PlanModelQuotaEntry>;
  aorExecution?: PlanModelAorExecution;
};

export type BindingSetResponse = {
  binding: {
    planVersionId: string;
    allowedModelIds: ModelRef[];
    updatedAt: string;
  };
  /** 写绑定后被刷新 entitlement 的存量订阅企业 tenantId。 */
  refreshedTenantIds: string[];
};
