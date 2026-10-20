/**
 * Package Entitlement — 套餐权益快照类型（V2 Phase 3）。
 *
 * 与 PlanVersion.snapshot（定价）解耦；订阅锁定 planVersionId 后，
 * 权益与定价分别投影。
 */

import type { SeatRole } from "../billing/types.js";

/** 超额策略（P0：block 为默认）。 */
export type EntitlementOveragePolicy = {
  type: "block" | "credits_only" | "pay_as_you_go";
  allowBurstConcurrency: boolean;
};

/** 套餐版本权益快照（旁路真源，不写入 billing/types PlanVersion）。 */
export type EntitlementSnapshot = {
  planVersionId: string;
  /** 月费（整数分）；通常与 PlanVersion.snapshot.basePriceCents 对齐。 */
  monthlyPriceCents: number;
  /** 周期 Credits 配额；0 表示不走 Credits（如 Enterprise 预算路径）。 */
  monthlyCredits: number;
  maxSeats: Partial<Record<SeatRole, number>>;
  maxBots: number;
  /**
   * 商业 AI 能力授权配额（基础/专业/高级），与 maxSeats 席位分列。
   * 冻结在套餐版本权益快照上；展示优先读此字段。
   */
  aiProfileQuota?: Partial<Record<"basic" | "pro" | "elite", number>>;
  /** 租户级同时活跃 Agent Run 上限；0 = 不限。 */
  maxConcurrentRuns: number;
  maxWorkflows?: number;
  maxKnowledgeBases?: number;
  allowedPolicies: string[];
  allowedTiers: string[];
  /** Official capability pack ids granted by this plan version (e.g. starter, cn-office). */
  capabilityPackIds?: string[];
  allowCustomPolicy?: boolean;
  allowPrivateModels?: boolean;
  overagePolicy: EntitlementOveragePolicy;
  features?: {
    auditLog?: boolean;
    mfa?: boolean;
    sso?: boolean;
    vpcIsolation?: boolean;
    /** P2 Wave 2：Credits v2 计价开关（默认 false，走 v1 tier 扣点）。 */
    creditsV2Enabled?: boolean;
  };
  updatedAt: string;
};

export type UsageLedgerEntry = {
  id: string;
  enterpriseId: string;
  /** 运行时订阅快照（Commercial Runtime 审计真源）。 */
  subscriptionSnapshotId?: string;
  subscriptionId?: string;
  userId?: string;
  billingSeatId?: string;
  orgSeatId?: string;
  botId?: string;
  runId?: string;
  authorizationDecisionId?: string;
  taskId: string;
  modelId: string;
  /**
   * Model provenance for enterprise governance:
   * - platform: subscription / platform catalog model
   * - enterprise: tenant BYOK asset
   */
  source?: "platform" | "enterprise";
  /** Who pays provider cost — platform supplier vs enterprise BYOK. */
  billingOwner?: "platform" | "enterprise";
  tier: string;
  policyId: string;
  creditsCharged: number;
  /**
   * PAYG 分账：套餐内 Credits / 超额 Credits / 超额金额（分）。
   * includedCredits + overageCredits === creditsCharged。
   */
  includedCredits?: number;
  overageCredits?: number;
  overageAmountCents?: number;
  /** P2 Wave 2：计价引擎版本（审计 / 对账分列）。 */
  pricingEngine?: "v1" | "v2";
  /** 供应商成本（整数分）；Phase 3 可为 0，Phase 4 接 CostVersion。 */
  providerCostCents: number;
  /** 客户侧收入归因（整数分）；Phase 3 可为 0。 */
  tenantRevenueCents: number;
  /** 写入时锁定的套餐（P4：避免换套餐后 ledger 归因漂移）。 */
  planId?: string;
  planVersionId?: string;
  inputTokens?: number;
  outputTokens?: number;
  /** P4：Credits v2 审计维度（可选）。 */
  toolCallCount?: number;
  durationMs?: number;
  retryCount?: number;
  occurredAt: string;
};

export type TenantCreditsBalance = {
  enterpriseId: string;
  cycleStart: string;
  monthlyCredits: number;
  creditsConsumed: number;
  creditsRemaining: number;
  updatedAt: string;
};
