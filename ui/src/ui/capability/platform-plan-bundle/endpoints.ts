/**
 * 平台「套餐版本 + 模型绑定」一体化 RPC 端点。
 */

import type {
  MeterDefinition,
  Plan,
  PlanVersion,
  PricingDiff,
  PricingType,
  RoleGrantProfileSummary,
  SeatRole,
} from "../cost-budget-billing/endpoints.ts";

export type { MeterDefinition };
import type { PricingCatalogViewModel } from "../platform-pricing-catalog/endpoints.ts";

export const PLATFORM_PLAN_BUNDLE_ENDPOINTS = {
  overview: "platform-plan-bundle.overview",
  get: "platform-plan-bundle.get",
  list: "platform-plan-bundle.list",
  create: "platform-plan-bundle.create",
  update: "platform-plan-bundle.update",
  createVersion: "platform-plan-bundle.create-version",
  activate: "platform-plan-bundle.activate",
  deprecate: "platform-plan-bundle.deprecate",
  deleteVersion: "platform-plan-bundle.delete-version",
  setMarketingTags: "platform-plan-bundle.set-marketing-tags",
  setMatchingProfile: "platform-plan-bundle.set-matching-profile",
  diff: "platform-plan-bundle.diff",
  consistency: "platform-plan-bundle.consistency",
  previewAllocation: "platform-plan-bundle.preview-allocation",
} as const;

/** 超额策略（P0：block 为默认）。 */
export type EntitlementOveragePolicy = {
  type: "block" | "credits_only" | "pay_as_you_go";
  allowBurstConcurrency: boolean;
};

export type PlatformEntitlementSnapshot = {
  planVersionId: string;
  monthlyPriceCents: number;
  monthlyCredits: number;
  maxSeats: Partial<Record<SeatRole, number>>;
  maxBots: number;
  /** 基础/专业/高级 AI 授权配额（与席位分列）。 */
  aiProfileQuota?: Partial<Record<"basic" | "pro" | "elite", number>>;
  maxConcurrentRuns?: number;
  maxWorkflows?: number;
  maxKnowledgeBases?: number;
  allowedPolicies: string[];
  allowedTiers: string[];
  allowCustomPolicy?: boolean;
  allowPrivateModels?: boolean;
  overagePolicy?: EntitlementOveragePolicy;
  features?: {
    auditLog?: boolean;
    mfa?: boolean;
    sso?: boolean;
    vpcIsolation?: boolean;
  };
  updatedAt: string;
};

export type PlatformPlanModelQuotaEntry = {
  /** 周期内允许的最大请求数（可选）。 */
  maxRequests?: number;
  /** 周期内允许的最大 token 数（可选）。 */
  maxTokens?: number;
};

/** Phase 4：模型级预算（独立于 modelQuota guardrail；周期内 Credits / 供应商花费上限）。 */
export type PlatformPlanModelBudgetEntry = {
  monthlyCreditsCap?: number;
  spendCapCents?: number;
};

export type PlatformPlanBundleBinding = {
  planVersionId: string;
  allowedModelIds: string[];
  allowedTiers?: string[];
  allowedPolicies?: string[];
  policyId?: string;
  modelQuota?: Record<string, PlatformPlanModelQuotaEntry>;
  modelBudgets?: Record<string, PlatformPlanModelBudgetEntry>;
  aorExecution?: {
    taskTypeId: string;
    selectorStrategy: "cheapest" | "best_quality" | "balanced" | "bandit";
    evaluatorMode: string;
  };
  updatedAt: string;
};

export type PlatformPlanBundleVersionRow = {
  versionId: string;
  version: number;
  status: PlanVersion["status"];
  snapshot: PlanVersion["snapshot"];
  binding?: PlatformPlanBundleBinding;
  entitlementSnapshot?: PlatformEntitlementSnapshot;
  bindingState: "missing" | "valid" | "invalid_catalog" | "empty";
  activationReady: boolean;
  activationBlockers: string[];
};

export type PlatformPlanBundlePlanRow = {
  plan: Plan;
  versions: PlatformPlanBundleVersionRow[];
};

export type PlatformPlanBundleOverviewResponse = {
  catalog: string[];
  plans: PlatformPlanBundlePlanRow[];
  pricingCatalog?: PricingCatalogViewModel;
};

export type PlatformPlanBundleListResponse = {
  plans: PlatformPlanBundlePlanRow[];
};

export type PlatformPlanBundleGetRequest = {
  planId: string;
};

export type PlatformPlanBundleGetResponse = PlatformPlanBundlePlanRow;

export type PlatformPlanBundleCreateRequest = {
  name: string;
  billingCycle: "monthly";
  basePriceCents: number;
  seatQuota?: Partial<Record<SeatRole, number>>;
  botQuota?: number;
  pricing: Array<{ type: PricingType; key: string; priceCents: number }>;
  /** 显式计量合同；与 Gateway MeterDefinition 对齐 */
  meters?: MeterDefinition[];
  allowedModelIds: string[];
  allowedTiers?: string[];
  allowedPolicies?: string[];
  policyId?: string;
  monthlyCredits?: number;
  aiProfileQuota?: Partial<Record<"basic" | "pro" | "elite", number>>;
  maxConcurrentRuns?: number;
  maxWorkflows?: number;
  maxKnowledgeBases?: number;
  allowCustomPolicy?: boolean;
  allowPrivateModels?: boolean;
  features?: PlatformEntitlementSnapshot["features"];
  overagePolicy?: EntitlementOveragePolicy;
  modelQuota?: Record<string, PlatformPlanModelQuotaEntry>;
  modelBudgets?: Record<string, PlatformPlanModelBudgetEntry>;
  aorExecution?: PlatformPlanBundleBinding["aorExecution"];
  slogan?: string;
  targetAudience?: string;
  marketingFeatures?: string[];
};

export type PlatformPlanBundleCreateResponse = {
  plan: Plan;
  version: PlanVersion | null;
  binding: PlatformPlanBundleBinding | null;
  entitlementSnapshot?: PlatformEntitlementSnapshot | null;
};

export type PlatformPlanBundleUpdateRequest = {
  planId: string;
  name?: string;
  basePriceCents?: number;
  seatQuota?: Partial<Record<SeatRole, number>>;
  botQuota?: number;
  pricing?: Array<{ type: PricingType; key: string; priceCents: number }>;
  meters?: MeterDefinition[];
  allowedModelIds: string[];
  allowedTiers?: string[];
  allowedPolicies?: string[];
  policyId?: string;
  monthlyCredits?: number;
  aiProfileQuota?: Partial<Record<"basic" | "pro" | "elite", number>>;
  maxConcurrentRuns?: number;
  maxWorkflows?: number;
  maxKnowledgeBases?: number;
  allowCustomPolicy?: boolean;
  allowPrivateModels?: boolean;
  features?: PlatformEntitlementSnapshot["features"];
  overagePolicy?: EntitlementOveragePolicy;
  modelQuota?: Record<string, PlatformPlanModelQuotaEntry>;
  modelBudgets?: Record<string, PlatformPlanModelBudgetEntry>;
  aorExecution?: PlatformPlanBundleBinding["aorExecution"];
  slogan?: string;
  targetAudience?: string;
  marketingFeatures?: string[];
};

export type PlatformPlanBundleUpdateResponse = {
  plan: Plan;
  version: PlanVersion;
  binding: PlatformPlanBundleBinding | null;
  entitlementSnapshot?: PlatformEntitlementSnapshot | null;
};

export type PlatformPlanBundleCreateVersionRequest = {
  planId: string;
  name?: string;
  basePriceCents?: number;
  seatQuota?: Partial<Record<SeatRole, number>>;
  botQuota?: number;
  pricing: Array<{ type: PricingType; key: string; priceCents: number }>;
  meters?: MeterDefinition[];
  allowedModelIds: string[];
  allowedTiers?: string[];
  allowedPolicies?: string[];
  policyId?: string;
  monthlyCredits?: number;
  aiProfileQuota?: Partial<Record<"basic" | "pro" | "elite", number>>;
  maxConcurrentRuns?: number;
  maxWorkflows?: number;
  maxKnowledgeBases?: number;
  allowCustomPolicy?: boolean;
  allowPrivateModels?: boolean;
  features?: PlatformEntitlementSnapshot["features"];
  overagePolicy?: EntitlementOveragePolicy;
  modelQuota?: Record<string, PlatformPlanModelQuotaEntry>;
  modelBudgets?: Record<string, PlatformPlanModelBudgetEntry>;
  aorExecution?: PlatformPlanBundleBinding["aorExecution"];
};

export type PlatformPlanBundleCreateVersionResponse = {
  plan: Plan;
  version: PlanVersion;
  binding: PlatformPlanBundleBinding | null;
  entitlementSnapshot?: PlatformEntitlementSnapshot | null;
};

export type PlatformPlanBundleActivateRequest = {
  planId: string;
  versionId: string;
  requestId?: string;
};

export type PlatformPlanBundleActivateResponse = {
  planVersion: PlanVersion;
  binding: PlatformPlanBundleBinding;
};

export type PlatformPlanBundleDeprecateRequest = {
  planId: string;
  versionId: string;
};

export type PlatformPlanBundleDeprecateResponse = {
  planVersion: PlanVersion;
  binding?: PlatformPlanBundleBinding;
};

export type PlatformPlanBundleDeleteVersionRequest = {
  planId: string;
  versionId: string;
};

export type PlatformPlanBundleDeleteVersionResponse = {
  deletedVersionId: string;
};

export type PlatformPlanBundleSetMarketingTagsRequest = {
  planId: string;
  marketingTags: Array<"default" | "recommended">;
};

export type PlatformPlanBundleSetMarketingTagsResponse = {
  plan: Plan;
};

export type PlatformPlanBundleSetMatchingProfileRequest = {
  planId: string;
  matchingProfile: PlanMatchingProfile;
};

export type PlanMatchingProfile = {
  targetPersonas?: string[];
  matchingPriority?: number;
  inPlanFlexibilityNotes?: string;
  beyondPlanNotes?: string;
};

export type PlatformPlanBundleSetMatchingProfileResponse = {
  plan: Plan;
};

export type PlatformPlanBundleDiffRequest = {
  fromVersionId: string;
  toVersionId: string;
};

export type PlatformPlanBundleDiffResponse = {
  diff: PricingDiff;
};

export type PlatformPlanBundleConsistencyIssue = {
  code: "plan_binding_missing" | "plan_binding_orphan" | "plan_binding_invalid_catalog";
  severity: "warning" | "info";
  planId?: string;
  planVersionId?: string;
  message: string;
  hint: string;
};

export type PlatformPlanBundleConsistencyResponse = {
  issues: PlatformPlanBundleConsistencyIssue[];
};

export type PlatformPlanBundlePreviewAllocationRequest = {
  planVersionId: string;
};

export type PlatformPlanBundlePreviewAllocationResponse = {
  preview: {
    planVersionId: string;
    allowedTiers: string[];
    entitledModelCount: number;
    roleProfiles: RoleGrantProfileSummary[];
    guide: { summary: string; steps: string[] };
  };
};

export type PlatformPlanBundleEndpoint =
  (typeof PLATFORM_PLAN_BUNDLE_ENDPOINTS)[keyof typeof PLATFORM_PLAN_BUNDLE_ENDPOINTS];
