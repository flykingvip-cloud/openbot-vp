import type { PricingCatalogViewModel } from "../platform-pricing-catalog/index.ts";

/**
 * RPC 端点契约 —— 成本与预算（Cost & Budget Billing）。
 *
 * 本模块拥有 `platform-plans.*` / `platform-pricing.*` / `subscriptions.*` /
 * `seats.*` / `budget.*` / `usage-ingest.*` / `resources.*` / `cost-control.*` /
 * `billing.*` 命名空间。类型镜像 gateway 端 `src/gateway/billing/types.ts`。
 */

export const COST_BUDGET_ENDPOINTS = {
  // 平台端（定义规则）
  plansCreate: "platform-plans.create",
  plansUpdate: "platform-plans.update",
  plansList: "platform-plans.list",
  pricingSet: "platform-pricing.set",
  pricingList: "platform-pricing.list",
  pricingCreateVersion: "platform-pricing.create-version",
  pricingActivate: "platform-pricing.activate",
  pricingDeprecate: "platform-pricing.deprecate",
  pricingDeleteVersion: "platform-pricing.delete-version",
  pricingListVersions: "platform-pricing.list-versions",
  /** @deprecated 请使用 `platform-plan-bundle.diff`。 */
  pricingDiff: "platform-pricing.diff",
  // 企业端（消费规则）
  subscribe: "subscriptions.subscribe",
  subscriptionGet: "subscriptions.get",
  changePlan: "subscriptions.change-plan",
  seatAssign: "seats.assign",
  seatSetRole: "seats.set-role",
  seatList: "seats.list",
  allocationOverview: "enterprise-allocation.overview",
  allocationApplyProfile: "enterprise-allocation.apply-profile",
  allocationSyncAllSeats: "enterprise-allocation.sync-all-seats",
  /** @deprecated 请使用 `subscriptions.preview-plan-allocation`。 */
  platformAllocationPreview: "platform-allocation.preview-plan",
  subscriptionPreviewPlanAllocation: "subscriptions.preview-plan-allocation",
  budgetSet: "budget.set",
  budgetGet: "budget.get",
  usageReport: "usage-ingest.report",
  resourcesSummary: "resources.summary",
  resourcesSetUserLimit: "resources.set-user-limit",
  resourcesCreateBot: "resources.create-bot",
  costControlCheck: "cost-control.check",
  dashboard: "billing.dashboard",
  consumptionForecastGet: "consumption-forecast.get",
  consumptionForecastBudgetSignals: "consumption-forecast.budget-signals",
  analytics: "billing.analytics",
  attributionBySeat: "billing.attribution-by-seat",
  attributionByPosition: "billing.attribution-by-position",
  exportPositionReport: "billing.export-position-report",
  listCreditsCycles: "billing.list-credits-cycles",
  commercialOrdersList: "commercial-orders.list",
  commercialOrdersGet: "commercial-orders.get",
  commercialOrdersCancel: "commercial-orders.cancel",
  commercialOrdersCheckoutInfo: "commercial-orders.checkout-info",
  billingProfileGet: "billing-profile.get",
  billingProfileSet: "billing-profile.set",
  invoicesList: "invoices.list",
  invoicesRequest: "invoices.request",
  commercialOrdersCreate: "commercial-orders.create",
  paymentsCreate: "payments.create",
} as const;

export type CostBudgetEndpoint = (typeof COST_BUDGET_ENDPOINTS)[keyof typeof COST_BUDGET_ENDPOINTS];

// ── 镜像类型（与 gateway billing/types.ts 一致）────────────────────────────

export type SeatRole = "viewer" | "creator" | "admin";
export type PricingType = "seat" | "usage" | "extra";
export type BillingCycle = "monthly" | "quarterly" | "annual";
export type PlanVersionStatus = "draft" | "active" | "deprecated";
export type SubscriptionStatus =
  | "pending_payment"
  | "active"
  | "suspended"
  | "expired"
  | "canceled";
export type SnapshotType = "estimated" | "final";
export type BudgetCheckLevel = "ok" | "alert" | "exceeded";
export type EnterpriseBillingMode = "credits" | "enterprise_budget";

export type EconomicsSummary = {
  taskCount: number;
  creditsCharged: number;
  providerCostCents: number;
  tenantRevenueCents: number;
  marginCents: number;
};

export type EconomicsByPricingEngine = Record<"v1" | "v2", EconomicsSummary>;

export type CreditsStatus = {
  monthlyCredits: number;
  creditsConsumed: number;
  creditsRemaining: number;
  cycleStart: string;
};

export type TenantCreditsCycle = {
  cycleStart: string;
  monthlyCredits: number;
  creditsConsumed: number;
  creditsRemaining: number;
  updatedAt: string;
};

export type PlanPricing = {
  id: string;
  planId: string;
  planVersionId: string;
  type: PricingType;
  key: string;
  priceCents: number;
};

export type PlanMatchingProfile = {
  targetPersonas?: string[];
  matchingPriority?: number;
  inPlanFlexibilityNotes?: string;
  beyondPlanNotes?: string;
};

export type Plan = {
  id: string;
  name: string;
  billingCycle: BillingCycle;
  basePriceCents: number;
  currentVersionId: string;
  seatQuota: Partial<Record<SeatRole, number>>;
  botQuota: number;
  status: "active" | "archived";
  marketingTags?: Array<"default" | "recommended">;
  matchingProfile?: PlanMatchingProfile;
  slogan?: string;
  targetAudience?: string;
  marketingFeatures?: string[];
  targetMarginRate?: number;
  guardMarginRate?: number;
  createdAt: string;
  updatedAt: string;
};

/** 与 Gateway PlanVersion.snapshot.meters 对齐的计量合同。 */
export type MeterDefinition = {
  key: string;
  unit: "credit" | "token" | "cent" | "count";
  includedQuota?: number;
  /** true=套餐内按量收费；false=套餐内免费 */
  chargeIncludedAtUsagePrice: boolean;
  /** true=允许付费超额；false=禁止超额 */
  allowOverage: boolean;
  aggregate?: "sum";
  rounding?: "integer";
};

export type PlanVersion = {
  id: string;
  planId: string;
  version: number;
  status: PlanVersionStatus;
  snapshot: {
    basePriceCents: number;
    seatQuota: Partial<Record<SeatRole, number>>;
    botQuota: number;
    pricing: PlanPricing[];
    meters?: MeterDefinition[];
  };
  createdAt: string;
  createdByUserId: string;
  activatedAt?: string;
  deprecatedAt?: string;
};

export type PricingDiffEntry = {
  type: PricingType;
  key: string;
  oldPriceCents: number | null;
  newPriceCents: number | null;
  change: "added" | "removed" | "changed" | "unchanged";
};

export type PricingDiff = {
  fromVersionId: string;
  toVersionId: string;
  entries: PricingDiffEntry[];
};

export type Subscription = {
  id: string;
  enterpriseId: string;
  planId: string;
  planVersionId: string;
  startTime: string;
  endTime: string | null;
  status: SubscriptionStatus;
  pendingChange?: {
    targetPlanId: string;
    targetPlanVersionId: string;
    effectiveAt: string;
  };
  resolvedFromPlanId?: boolean;
  migratedBinding?: boolean;
  commercialContract?: {
    billingCycle: BillingCycle;
    contractStart: string;
    contractEnd: string;
  };
  createdAt: string;
};

export type Seat = {
  id: string;
  enterpriseId: string;
  userId: string;
  currentRole: SeatRole;
  botQuota: number;
  createdAt: string;
};

export type SeatHistoryInterval = {
  id: string;
  seatId: string;
  enterpriseId: string;
  role: SeatRole;
  startTime: string;
  endTime: string | null;
};

export type BudgetControls = {
  limitAiCalls: boolean;
  limitBotCreation: boolean;
  autoDowngrade: boolean;
};

export type Budget = {
  id: string;
  enterpriseId: string;
  monthlyLimitCents: number;
  alertThreshold: number;
  controls: BudgetControls;
  updatedAt: string;
};

export type BudgetStatus = {
  level: BudgetCheckLevel;
  monthlyLimitCents: number;
  alertThreshold: number;
  accruedCents: number;
  predictedCents: number | null;
};

// ── Request / Response ─────────────────────────────────────────────────────

export type PlansListResponse = { plans: Plan[] };
export type PlanCreateRequest = {
  name: string;
  billingCycle: BillingCycle;
  basePriceCents: number;
  seatQuota?: Partial<Record<SeatRole, number>>;
  botQuota?: number;
  pricing?: Array<{ type: PricingType; key: string; priceCents: number }>;
  meters?: MeterDefinition[];
};
export type PlanCreateResponse = { planId: string; plan: Plan };
export type PlanUpdateRequest = {
  planId: string;
  name?: string;
  basePriceCents?: number;
  seatQuota?: Partial<Record<SeatRole, number>>;
  botQuota?: number;
  pricing?: Array<{ type: PricingType; key: string; priceCents: number }>;
  meters?: MeterDefinition[];
};
export type PlanUpdateResponse = { planVersionId: string; plan: Plan };
export type PricingSetRequest = {
  planId: string;
  type: PricingType;
  key: string;
  priceCents: number;
};
export type PricingSetResponse = { pricingId?: string; planVersionId: string };
export type PricingListRequest = { planId: string };
export type PricingListResponse = { pricing: PlanPricing[] };

export type PricingCreateVersionRequest = {
  planId: string;
  pricing?: Array<{ type: PricingType; key: string; priceCents: number }>;
  basePriceCents?: number;
  seatQuota?: Partial<Record<SeatRole, number>>;
  botQuota?: number;
  meters?: MeterDefinition[];
};
export type PricingCreateVersionResponse = { planVersionId: string; version: PlanVersion };
export type PricingActivateRequest = { planId: string; versionId: string; requestId?: string };
export type PricingActivateResponse = { planVersion: PlanVersion };
export type PricingDeprecateRequest = { planId: string; versionId: string };
export type PricingDeprecateResponse = { planVersion: PlanVersion };
export type PricingDeleteVersionRequest = { planId: string; versionId: string };
export type PricingDeleteVersionResponse = { deletedVersionId: string };
export type PricingListVersionsRequest = { planId: string };
export type PricingListVersionsResponse = { versions: PlanVersion[] };
export type PricingDiffRequest = { fromVersionId: string; toVersionId: string };
export type PricingDiffResponse = { diff: PricingDiff };

export type SubscribeRequest = { planId?: string; planVersionId?: string };
export type SubscriptionProvisioning = {
  entitlement: { allowedModelIds: string[]; planVersionId?: string } | null;
  creditsInitialized: boolean;
  monthlyCredits: number;
  seatGrantsSynced: { applied: number; skipped: number };
  seatBootstrap?: {
    orgReady: boolean;
    orgSeatCount: number;
    memberCandidates: number;
    assigned: number;
    skipped: number;
    results: Array<{
      userEmail: string;
      role: SeatRole;
      seatId: string;
      modelCount: number;
      source: "org_position" | "membership";
    }>;
    skippedDetails: Array<{ userEmail: string; reason: string }>;
  };
};

export type CommercialOrderSummary = {
  id: string;
  status: string;
  amountCents: number;
  kind: string;
  createdAt?: string;
  lineItems?: Array<{ label: string; amountCents: number }>;
  paymentMethod?: string;
};

export type CommercialOrderDetail = CommercialOrderSummary & {
  currency?: string;
  billingCycle?: BillingCycle;
  planId?: string;
  /** change_plan：更换前套餐 id（服务端 fromPlanId，兼容旧单可回退 planId）。 */
  fromPlanId?: string;
  targetPlanId?: string;
  paidAt?: string;
};

export type CommercialOrdersListResponse = {
  orders: CommercialOrderDetail[];
};

export type CommercialOrderGetResponse = {
  order: CommercialOrderDetail;
  payments: Array<{ id: string; status: string; amountCents: number }>;
};

export type BankTransferInstructions = {
  accountName: string;
  bankName: string;
  accountNumber: string;
  remarkHint: string;
};

export type TenantBillingProfile = {
  enterpriseId: string;
  legalName: string;
  taxId: string;
  invoiceType: "vat_special" | "vat_normal" | "electronic";
  bankAccount?: string;
  address?: string;
  contactEmail?: string;
  updatedAt: string;
};

export type BillingProfileGetResponse = {
  profile: TenantBillingProfile | null;
  complete: boolean;
};

export type BillingProfileSetRequest = {
  legalName: string;
  taxId: string;
  invoiceType: TenantBillingProfile["invoiceType"];
  bankAccount?: string;
  address?: string;
  contactEmail?: string;
};

export type InvoiceRequest = {
  id: string;
  enterpriseId: string;
  orderId?: string;
  billId?: string;
  amountCents: number;
  status: "pending" | "issued" | "rejected";
  invoiceNo?: string;
  issuedAt?: string;
  pdfUrl?: string;
  rejectReason?: string;
  createdAt: string;
};

export type InvoicesListResponse = {
  requests: InvoiceRequest[];
};

export type CommercialOrderCreateResponse = {
  order: CommercialOrderDetail;
  payment: { id: string; status: string; amountCents: number; checkoutUrl?: string } | null;
  bankTransfer: BankTransferInstructions | null;
  autoPaid: boolean;
};

export type PaymentCreateResponse = {
  payment: {
    id: string;
    status: string;
    amountCents: number;
    provider: string;
    checkoutUrl?: string;
  };
  checkoutUrl?: string;
  qrContent?: string;
};

export type SubscribeResponse = {
  commerce?: boolean;
  order?: CommercialOrderSummary;
  payment?: { id: string; status: string } | null;
  bankTransfer?: BankTransferInstructions | null;
  autoPaid?: boolean;
  subscription: Subscription | null;
  provisioning?: SubscriptionProvisioning;
};
export type SubscriptionGetResponse = {
  subscription: Subscription | null;
  planView: Plan | null;
  planVersion?: PlanVersion | null;
  currentPlanVersion?: PlanVersion | null;
  pricingSnapshot?: PlanPricing[];
  pricingView: PlanPricing[];
  entitlementSnapshot?: unknown;
  /** 各可选套餐 currentVersion 的 entitlement（planId → snapshot）。 */
  planEntitlements?: Record<string, unknown>;
  creditsStatus?: CreditsStatus | null;
  billingMode?: EnterpriseBillingMode | null;
  availablePlans: Plan[];
  /** Pricing v3 catalog（PlanVersion + EntitlementSnapshot 投影）。 */
  pricingCatalog?: PricingCatalogViewModel;
  pendingOrders?: CommercialOrderSummary[];
};
export type SubscriptionPreviewPlanAllocationResponse = PlanAllocationPreviewResponse & {
  entitlement?: unknown;
};
export type ChangePlanRequest = { targetPlanId: string; effective: "now" | "next" };
export type ChangePlanResponse = {
  commerce?: boolean;
  order?: CommercialOrderSummary;
  payment?: { id: string; status: string } | null;
  bankTransfer?: BankTransferInstructions | null;
  autoPaid?: boolean;
  subscription: Subscription | null;
  mode: "now" | "next";
  provisioning?: SubscriptionProvisioning;
};
export type AllocationSyncAllSeatsResponse = {
  applied: number;
  skipped: number;
  results: Array<{ seatId: string; role: string; applied: boolean; modelCount: number }>;
};
export type PlanAllocationPreviewResponse = {
  preview: {
    planVersionId: string;
    allowedTiers: string[];
    entitledModelCount: number;
    roleProfiles: RoleGrantProfileSummary[];
    guide: { summary: string; steps: string[] };
  };
};

export type SeatAssignRequest = {
  userId: string;
  role: SeatRole;
  botQuota?: number;
  applyModelGrant?: boolean;
};
export type RoleGrantProfileSummary = {
  role: SeatRole;
  label: string;
  description: string;
  tierIds: string[];
  modelIds: string[];
  modelCount: number;
  seatPriceCents?: number | null;
};
export type SeatWithGrantSummary = Seat & { grantedModelCount: number };
export type AllocationOverviewResponse = {
  subscribed: boolean;
  strategy: "ceiling_plan_role_grant";
  ceiling: {
    planName: string | null;
    planVersionId: string | null;
    allowedTiers: string[];
    entitledModelCount: number;
    monthlyCredits: number | null;
  };
  roleProfiles: RoleGrantProfileSummary[];
  seats: SeatWithGrantSummary[];
  grants: unknown[];
  guide: { summary: string; steps: string[] };
};
export type SeatAssignResponse = {
  seat: Seat;
  modelGrant?: { grant: unknown; profile: RoleGrantProfileSummary | null };
};
export type SeatSetRoleRequest = { seatId: string; role: SeatRole; applyModelGrant?: boolean };
export type SeatSetRoleResponse = {
  seat: Seat;
  interval: SeatHistoryInterval;
  modelGrant?: { grant: unknown; profile: RoleGrantProfileSummary | null };
};
export type AllocationApplyProfileRequest = { seatId: string; role: SeatRole };
export type AllocationApplyProfileResponse = {
  applied: boolean;
  grant: unknown;
  profile: RoleGrantProfileSummary | null;
};
export type SeatListResponse = { seats: Seat[]; intervals: SeatHistoryInterval[] };

export type BudgetSetRequest = {
  monthlyLimitCents: number;
  alertThreshold?: number;
  controls?: Partial<BudgetControls>;
};
export type BudgetSetResponse = { budget: Budget };
export type BudgetGetResponse = { budget: Budget | null; history: unknown[] };

export type UsageReportRequest = {
  eventId: string;
  key: string;
  quantity: number;
  userId?: string;
  occurredAt?: string;
};
export type UsageReportResponse = { recorded: boolean; deduped: boolean };

export type ResourcesSummaryResponse = {
  usedBots: number;
  quota: number;
  ratio: number;
  perUser: Record<string, number>;
  concurrencyUsed: number;
  concurrencyLimit: number;
};
export type ResourcesSetUserLimitRequest = { userId: string; limit: number };
export type ResourcesCreateBotRequest = { ownerUserId?: string };

export type ForecastRiskLevel = "none" | "low" | "medium" | "high";

export type ConsumptionForecast = {
  enterpriseId: string;
  cycleStart: string;
  cycleEnd: string;
  computedAt: string;
  forecastCostCents: number | null;
  forecastCostInsufficientData: boolean;
  creditsRemaining: number;
  monthlyCredits: number;
  creditsEtaDays: number | null;
  creditsEtaInsufficientData: boolean;
  concurrencyUsed: number;
  concurrencyLimit: number;
  concurrencyPeakInCycle: number;
  concurrencyRisk: ForecastRiskLevel;
  concurrencyRiskMessage?: string;
  marginCents: number;
  tenantRevenueCents: number;
  providerCostCents: number;
  marginRatio: number | null;
  marginWarning: ForecastRiskLevel;
  marginWarningMessage?: string;
  forecastCostMode?: "linear" | "wma";
  activeBots?: number;
  maxBots?: number;
  botsCreatedInCycle?: number;
  botGrowthRatePerDay?: number | null;
  projectedBotsAtCycleEnd?: number | null;
  botGrowthInsufficientData?: boolean;
  botQuotaRisk?: ForecastRiskLevel;
  botQuotaRiskMessage?: string;
};

export type CapacityRecommendation = {
  id: string;
  kind: "upgrade_plan" | "top_up_credits" | "reduce_concurrency" | "contact_sales";
  trigger: "bot_quota" | "concurrency" | "credits" | "margin" | "cost";
  severity: ForecastRiskLevel;
  title: string;
  message: string;
  decisionOptions?: Array<{ id: string; label: string; planId?: string }>;
};

export type ConsumptionForecastGetResponse = {
  subscribed: boolean;
  forecast: ConsumptionForecast | null;
  recommendations?: CapacityRecommendation[];
};

export type CostControlCheckRequest = { action: "ai" | "bot" };
export type CostControlCheckResponse = {
  allowed: boolean;
  reason?: string;
  budgetLevel: BudgetCheckLevel;
};

export type TenantCapabilities = {
  /** Gateway 平台 AOR 增强模式已启用（Phase 4.7 UI 信号）。 */
  aor?: boolean;
};

export type CommercialGovernanceStatus = "normal" | "over_allocated";

export type OverAllocationBlockedAction =
  | "assign_seat"
  | "create_bot"
  | "duplicate_bot"
  | "upgrade_seat_profile"
  | "run_high_tier";

export type OverAllocationState = {
  enterpriseId: string;
  subscriptionSnapshotId: string;
  status: CommercialGovernanceStatus;
  seatsOver: number;
  botsOver: number;
  seatProfilesOver: number;
  privateModelsOver: number;
  workflowsOver: number;
  blockedActions: OverAllocationBlockedAction[];
  detectedAt: string;
  updatedAt: string;
};

export type BillingReconciliationResult = {
  enterpriseId: string;
  cycleStart: string;
  cycleEnd: string;
  bucketGranted: number;
  bucketConsumed: number;
  bucketRemaining: number;
  ledgerCreditsCharged: number;
  ledgerCreditsV1: number;
  ledgerCreditsV2: number;
  legacyBalance?: {
    enterpriseId: string;
    cycleStart: string;
    monthlyCredits: number;
    creditsConsumed: number;
    creditsRemaining: number;
  } | null;
  aligned: boolean;
  driftCredits: number;
  details: string[];
};

export type EnterpriseComplianceStatus = "compliant" | "attention" | "action_required";

export type EnterprisePrivateModelStatus = "disabled" | "compliant" | "over_allocated";

export type CreditsV2RolloutStage = "off" | "canary" | "full";

export type CommercialRuntimeDriftSnapshot = {
  enterpriseId: string;
  cycleStart: string;
  cycleEnd: string;
  reconciliationAligned: boolean;
  reconciliationDriftCredits: number;
  ledgerCreditsV1: number;
  ledgerCreditsV2: number;
  calibrationSampleCount: number;
  calibrationMeanDeltaV2MinusV1: number | null;
  calibrationMaxAbsDelta: number;
};

export type GovernancePendingApprovalItem = {
  approvalId: string;
  category: string;
  displayName: string;
  requestedAt: string;
};

export type EnterpriseAIGovernanceProjection = {
  enterpriseId: string;
  creditsV2Enabled: boolean;
  creditsV2RolloutStage?: CreditsV2RolloutStage;
  creditsV2Effective?: boolean;
  creditsPricingEngine: "v1" | "v2";
  auditLogEnabled: boolean;
  mfaEnabled: boolean;
  ssoEnabled: boolean;
  vpcIsolationEnabled: boolean;
  tenantAllowPrivateModels: boolean;
  privateModelsCompliant: boolean;
  privateModelsOver: number;
  privateModelStatus?: EnterprisePrivateModelStatus;
  pendingApprovalsCount: number;
  pendingApprovalsByCategory?: Record<string, number>;
  recentPendingApprovals?: GovernancePendingApprovalItem[];
  auditCoverageRatio?: number | null;
  auditCoverageGap?: number;
  complianceStatus?: EnterpriseComplianceStatus;
  complianceIssues?: string[];
};

export type KnowledgeGovernanceCreditsSummary = {
  cycleStart: string;
  cycleEnd: string;
  llmCallCount: number;
  creditsCharged: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  providerCostCents: number;
  tenantRevenueCents: number;
};

export type DashboardResponse = {
  subscribed: boolean;
  planView?: Plan | null;
  cycleStart?: string;
  cycleEnd?: string;
  accruedCents: number;
  seatCostCents: number;
  usageCostCents: number;
  extraCostCents: number;
  missingPriceKeys?: string[];
  predictedCents: number | null;
  budgetStatus: BudgetStatus;
  billingMode?: EnterpriseBillingMode;
  creditsStatus?: CreditsStatus | null;
  economics?: EconomicsSummary & {
    cycleStart: string;
    cycleEnd: string;
    byPricingEngine?: EconomicsByPricingEngine;
  };
  commercialGovernanceStatus?: CommercialGovernanceStatus;
  aiGovernance?: EnterpriseAIGovernanceProjection | null;
  overAllocation?: OverAllocationState | null;
  consumptionForecast?: ConsumptionForecast | null;
  creditsReconciliation?: BillingReconciliationResult | null;
  knowledgeGovernanceCredits?: KnowledgeGovernanceCreditsSummary | null;
  commercialRuntimeDrift?: CommercialRuntimeDriftSnapshot | null;
  snapshotType: SnapshotType;
  computedAt: string;
  stale: boolean;
  tenantCapabilities?: TenantCapabilities;
};

export type AnalyticsRequest = { startTime?: string; endTime?: string };
export type AnalyticsResponse = {
  startTime: string;
  endTime: string;
  totalQuantity: number;
  byUser: Record<string, number>;
  byKey: Record<string, number>;
  recordCount: number;
  tenantCapabilities?: TenantCapabilities;
};

export type SeatAttributionRow = {
  billingSeatId: string;
  userId: string;
  billingRole: SeatRole;
  seatCostCents: number;
  usageQuantity: number;
  usageCostCents: number;
  totalCostCents: number;
};

export type SeatAttributionRequest = { startTime?: string; endTime?: string };
export type SeatAttributionResponse = {
  subscribed: boolean;
  cycleStart: string;
  cycleEnd: string;
  rows: SeatAttributionRow[];
  summary: {
    seatCostCents: number;
    usageCostCents: number;
    totalCostCents: number;
  };
  missingPriceKeys: string[];
};

export type PositionAgentAttributionRow = {
  agentId: string;
  usageQuantity: number;
  usageCostCents: number;
  byKey: Record<string, number>;
};

export type PositionAttributionRow = {
  orgSeatId: string;
  positionTitle: string;
  teamLabel: string;
  memberUserId: string | null;
  billingSeatId: string | null;
  billingRole: SeatRole | null;
  seatCostCents: number;
  usageCostCents: number;
  totalCostCents: number;
  usageQuantity: number;
  agents: PositionAgentAttributionRow[];
  unallocatedAgentUsageQuantity: number;
  unallocatedAgentUsageCostCents: number;
};

export type PositionAttributionRequest = { startTime?: string; endTime?: string };
export type PositionAttributionResponse = {
  subscribed: boolean;
  cycleStart: string;
  cycleEnd: string;
  rows: PositionAttributionRow[];
  summary: {
    seatCostCents: number;
    usageCostCents: number;
    totalCostCents: number;
  };
  missingPriceKeys: string[];
};

export type ExportPositionReportRequest = {
  startTime?: string;
  endTime?: string;
  variant?: "summary" | "daily";
};
export type ExportPositionReportResponse = {
  filename: string;
  contentType: string;
  content: string;
};

export type ListCreditsCyclesResponse = { cycles: TenantCreditsCycle[] };
