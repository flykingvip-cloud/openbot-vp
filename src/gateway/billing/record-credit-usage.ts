/**
 * Credits 用量记录编排（IO 层，供 agent-runner / usage-ingest 调用）。
 *
 * 双写：
 * - UsageLedger（任务级审计）
 * - UsageRecord key=ai_credits（与既有 billing 用量管道兼容）
 */

import { resolveModelCostRates } from "../cost-version/cost-version-store.js";
import {
  computeProviderCostCents,
  computeTenantRevenueCents,
  type TokenUsageInput,
} from "../cost-version/provider-cost.js";
import { aggregateLedgerEconomicsByPricingEngine } from "../economics/aggregate-by-pricing-engine.js";
import { aggregateLedgerEconomics } from "../economics/aggregate.js";
import { getPlanEntitlementSnapshot } from "../package-entitlement/plan-version-entitlement-store.js";
import { listCreditWeights } from "../resource-catalog/credit-weights-store.js";
import { getResourceModelCatalogEntry } from "../resource-catalog/models-catalog-store.js";
import {
  ensurePlanCycleCreditBucket,
  listCreditBucketsForCycle,
  reserveAndDebitCreditsForTask,
  summarizeCreditBucketsForCycle,
  syncPlanCycleBucketFromLegacyBalance,
} from "./credit-buckets-store.js";
import {
  getCreditUsageStage,
  stageAtLeast,
  upsertCreditUsageStage,
  type CreditUsageStage,
} from "./credit-usage-stage-store.js";
import { resolveEffectiveCreditsV2Enabled } from "./credits-v2-rollout.js";
import { billingEventBus } from "./event-bus.js";
import { getPlanVersion } from "./plans-store.js";
import { resolveCommercialCreditCost } from "./resolve-commercial-credit-cost.js";
import { resolveEnterpriseCreditsResetWindow } from "./runtime.js";
import {
  getActiveSubscriptionRuntimeSnapshot,
  getSubscriptionRuntimeSnapshot,
} from "./subscription-runtime-snapshots-store.js";
import { getSubscription } from "./subscriptions-store.js";
import { getActiveSubscription } from "./subscriptions-store.js";
import { consumeTenantCredits, ensureTenantCreditsAllocation } from "./tenant-credits-store.js";
import { resolveUsageAttributionTags } from "./usage-attribution-context.js";
import {
  appendUsageLedgerEntry,
  getUsageLedgerEntryByTaskId,
  listUsageLedgerEntries,
} from "./usage-ledger-store.js";
import { recordUsage } from "./usage-records-store.js";

export type RecordCreditUsageInput = {
  enterpriseId: string;
  taskId: string;
  modelId: string;
  policyId: string;
  userId?: string;
  agentId?: string;
  orgSeatId?: string;
  billingSeatId?: string;
  botId?: string;
  runId?: string;
  subscriptionSnapshotId?: string;
  subscriptionId?: string;
  planId?: string;
  planVersionId?: string;
  authorizationDecisionId?: string;
  occurredAt?: string;
  tokenUsage?: TokenUsageInput;
  toolCallCount?: number;
  toolClasses?: readonly string[];
  durationMs?: number;
  retryCount?: number;
  /** 测试注入 store 路径 */
  storePaths?: CreditUsageStorePaths;
};

export type CreditUsageStorePaths = {
  subscriptions?: string;
  plans?: string;
  entitlementSnapshot?: string;
  creditWeights?: string;
  modelCatalog?: string;
  costVersions?: string;
  tenantCredits?: string;
  usageLedger?: string;
  usage?: string;
  seatAssets?: string;
  runtimeSnapshots?: string;
  creditBuckets?: string;
  creditUsageStages?: string;
  /** Preflight credit reservation store (hold/settle). */
  creditReservations?: string;
  // plans/subscriptions used by resolveEnterpriseCycleWindow for contract periods
};

/**
 * Enterprise BYOK runtime model ids are tenant-isolated (`ent/<hash>/…`).
 * Commercial rule: do not debit platform Credits / PAYG overage for these runs.
 * Ledger still records provenance (`billingOwner=enterprise`) and provider cost.
 */
export function isEnterpriseByokModelId(modelId: string): boolean {
  return modelId.trim().startsWith("ent/");
}

export type RecordCreditUsageResult = {
  recorded: boolean;
  deduped: boolean;
  creditsCharged: number;
  includedCredits?: number;
  overageCredits?: number;
  overageAmountCents?: number;
  tier: string;
  providerCostCents: number;
  tenantRevenueCents: number;
  skippedConsumption: boolean;
  /** 本次结束时阶段机状态（便于审计/重试观测） */
  stage?: CreditUsageStage;
  /** true = 从中途阶段续跑（非首次完整写入） */
  resumed?: boolean;
};

function usageEventId(taskId: string): string {
  return `credit:${taskId.trim()}`;
}

function resolveCreditPriceCents(
  pricing: Array<{ type: string; key: string; priceCents: number }>,
): number | null {
  const entry = pricing.find((p) => p.type === "usage" && p.key === "ai_credits");
  return entry?.priceCents ?? null;
}

/** PAYG 超额必须有 extra/ai_credits；禁止回退 usage 价伪装超额。 */
function resolvePaygExtraUnitPriceCents(
  pricing: Array<{ type: string; key: string; priceCents: number }>,
): number | null {
  const extra = pricing.find((p) => p.type === "extra" && p.key === "ai_credits");
  if (!extra) {
    return null;
  }
  return Math.max(0, Math.floor(extra.priceCents));
}

function meterAllowsOverage(
  meters: Array<{ key: string; allowOverage?: boolean }> | undefined,
  key: string,
): boolean {
  const m = meters?.find((row) => row.key === key);
  return m?.allowOverage === true;
}

export class PaygConfigError extends Error {
  readonly code = "PAYG_CONFIG_ERROR" as const;
  constructor(message: string) {
    super(message);
    this.name = "PaygConfigError";
  }
}

export type PaygCreditSplit = {
  includedCredits: number;
  overageCredits: number;
  overageAmountCents: number;
};

/** 按剩余额度拆分套餐内 / PAYG 超额。 */
export function splitPaygCredits(args: {
  creditsCharged: number;
  creditsRemaining: number;
  overageUnitPriceCents: number;
  overagePolicyType: "block" | "credits_only" | "pay_as_you_go";
}): PaygCreditSplit {
  const charged = Math.max(0, Math.floor(args.creditsCharged));
  const remaining = Math.max(0, Math.floor(args.creditsRemaining));
  if (args.overagePolicyType !== "pay_as_you_go") {
    // block / credits_only：不拆超额（不足应在 authorize 拒绝）；落账时全记 included
    return {
      includedCredits: charged,
      overageCredits: 0,
      overageAmountCents: 0,
    };
  }
  const includedCredits = Math.min(remaining, charged);
  const overageCredits = Math.max(0, charged - includedCredits);
  return {
    includedCredits,
    overageCredits,
    overageAmountCents: overageCredits * Math.max(0, Math.floor(args.overageUnitPriceCents)),
  };
}

/**
 * 记录一次模型运行 Credits 消耗（幂等：同一 taskId 不重复扣费）。
 */
export async function recordCreditUsage(
  input: RecordCreditUsageInput,
): Promise<RecordCreditUsageResult> {
  const taskId = input.taskId.trim();
  const modelId = input.modelId.trim();
  if (!taskId || !modelId) {
    throw new Error("taskId and modelId are required");
  }

  const attribution = await resolveUsageAttributionTags({
    enterpriseId: input.enterpriseId,
    agentId: input.agentId,
    orgSeatId: input.orgSeatId,
    userId: input.userId,
    seatAssetsPath: input.storePaths?.seatAssets,
  });

  // 锁定授权时点的订阅事实，避免 run 期间换套餐导致 ledger 归因漂移。
  let subscriptionId = input.subscriptionId?.trim();
  let planId = input.planId?.trim();
  let planVersionId = input.planVersionId?.trim();
  let lockedRuntimeSnapshot: Awaited<ReturnType<typeof getSubscriptionRuntimeSnapshot>> = null;

  const snapshotId = input.subscriptionSnapshotId?.trim();
  if (snapshotId) {
    lockedRuntimeSnapshot = await getSubscriptionRuntimeSnapshot(
      snapshotId,
      input.storePaths?.runtimeSnapshots,
    );
    if (lockedRuntimeSnapshot) {
      subscriptionId = subscriptionId ?? lockedRuntimeSnapshot.subscriptionId;
      planId = planId ?? lockedRuntimeSnapshot.planId;
      planVersionId = planVersionId ?? lockedRuntimeSnapshot.planVersionId;
    }
  }

  if (!planVersionId) {
    const subscription = await getActiveSubscription(
      input.enterpriseId,
      input.storePaths?.subscriptions,
    );
    if (!subscription) {
      return {
        recorded: false,
        deduped: false,
        creditsCharged: 0,
        tier: "unknown",
        providerCostCents: 0,
        tenantRevenueCents: 0,
        skippedConsumption: true,
      };
    }
    subscriptionId = subscriptionId ?? subscription.id;
    planId = planId ?? subscription.planId;
    planVersionId = planVersionId ?? subscription.planVersionId;
  }

  const catalogEntry = await getResourceModelCatalogEntry(modelId, input.storePaths?.modelCatalog);
  const tier = catalogEntry?.tier?.trim() || "unknown";
  const enterpriseByok = isEnterpriseByokModelId(modelId);

  const entitlement = lockedRuntimeSnapshot
    ? null
    : planVersionId
      ? await getPlanEntitlementSnapshot(planVersionId, input.storePaths?.entitlementSnapshot)
      : null;
  const activeRuntimeSnapshot =
    lockedRuntimeSnapshot ??
    (snapshotId
      ? null
      : await getActiveSubscriptionRuntimeSnapshot(
          input.enterpriseId,
          input.storePaths?.runtimeSnapshots,
        ));
  const monthlyCredits = enterpriseByok
    ? 0
    : (lockedRuntimeSnapshot?.entitlementSnapshot.monthlyCredits ??
      activeRuntimeSnapshot?.entitlementSnapshot.monthlyCredits ??
      entitlement?.monthlyCredits ??
      0);
  const planVersion = planVersionId
    ? await getPlanVersion(planVersionId, input.storePaths?.plans)
    : null;
  const pricingRows = planVersion?.snapshot.pricing ?? [];
  const creditPriceCents = resolveCreditPriceCents(pricingRows);
  const paygExtraUnitPriceCents = resolvePaygExtraUnitPriceCents(pricingRows);
  const overagePolicyType =
    lockedRuntimeSnapshot?.entitlementSnapshot.overagePolicy?.type ??
    activeRuntimeSnapshot?.entitlementSnapshot.overagePolicy?.type ??
    entitlement?.overagePolicy?.type ??
    "block";
  const allowMeterOverage = meterAllowsOverage(planVersion?.snapshot.meters, "ai_credits");
  // PAYG 必须具备 extra 价 + Meter.allowOverage；禁止 0 价超额或无配置 silently 放行
  // BYOK 不走平台 PAYG，跳过该校验。
  if (!enterpriseByok && overagePolicyType === "pay_as_you_go") {
    if (!allowMeterOverage) {
      throw new PaygConfigError(
        "PAYG requires meter allowOverage=true for ai_credits; refuse overage charge",
      );
    }
    if (paygExtraUnitPriceCents == null) {
      throw new PaygConfigError(
        "PAYG requires extra/ai_credits unit price; refuse overage charge without extra pricing",
      );
    }
  }
  const overageUnitPriceCents = paygExtraUnitPriceCents ?? 0;

  const weights = await listCreditWeights(input.storePaths?.creditWeights);
  const entitlementFeatures =
    lockedRuntimeSnapshot?.entitlementSnapshot.features ??
    activeRuntimeSnapshot?.entitlementSnapshot.features ??
    entitlement?.features;
  const creditsV2Enabled = resolveEffectiveCreditsV2Enabled(
    input.enterpriseId,
    entitlementFeatures,
  );
  const pricing = resolveCommercialCreditCost({
    creditsV2Enabled,
    tier,
    weights,
    tokenUsage: input.tokenUsage,
    toolCallCount: input.toolCallCount,
    toolClasses: input.toolClasses,
    durationMs: input.durationMs,
    retryCount: input.retryCount,
  });
  const creditsChargedRaw = pricing.creditsCharged;
  const pricingEngine = pricing.pricingEngine;
  // BYOK: platform Credits are not sold for the call; keep raw cost for observability only.
  const creditsCharged = enterpriseByok ? 0 : creditsChargedRaw;
  const costRates = await resolveModelCostRates(modelId, {
    costVersions: input.storePaths?.costVersions,
    modelCatalog: input.storePaths?.modelCatalog,
  });
  const providerCostCents = computeProviderCostCents({
    usage: input.tokenUsage ?? {},
    inputCostPer1MCents: costRates.inputCostPer1MCents,
    outputCostPer1MCents: costRates.outputCostPer1MCents,
  });
  const tenantRevenueCents = enterpriseByok
    ? 0
    : computeTenantRevenueCents({
        creditsCharged,
        creditPriceCents,
      });

  // Credits 重置周期 ≠ 合同付款周期。且必须用锁定订阅，禁止升级后 active 把旧任务扣入新桶。
  const at = input.occurredAt ? new Date(input.occurredAt) : new Date();
  let lockedSubForCycle: Awaited<ReturnType<typeof getSubscription>> = null;
  if (subscriptionId) {
    lockedSubForCycle = await getSubscription(
      input.enterpriseId,
      subscriptionId,
      input.storePaths?.subscriptions,
    );
  }

  // runtime snapshot 投影：必须带 expiresAt(=contractEnd)；禁止伪造 +365 天无限延伸合同
  if (!lockedSubForCycle && lockedRuntimeSnapshot) {
    // 再试一次按 snapshot.subscriptionId 加载真实订阅（含 commercialContract）
    lockedSubForCycle = await getSubscription(
      input.enterpriseId,
      lockedRuntimeSnapshot.subscriptionId,
      input.storePaths?.subscriptions,
    );
  }
  if (!lockedSubForCycle && lockedRuntimeSnapshot) {
    if (!lockedRuntimeSnapshot.expiresAt) {
      // 无合同结束边界的快照不得用于开新 Credits 桶（防合同结束后继续重置）
      throw new Error(
        `runtime snapshot ${lockedRuntimeSnapshot.id} missing expiresAt/contractEnd; refuse credits cycle`,
      );
    }
    lockedSubForCycle = {
      id: lockedRuntimeSnapshot.subscriptionId,
      enterpriseId: input.enterpriseId,
      planId: lockedRuntimeSnapshot.planId,
      planVersionId: lockedRuntimeSnapshot.planVersionId,
      startTime: lockedRuntimeSnapshot.effectiveAt,
      endTime: lockedRuntimeSnapshot.expiresAt,
      status: "active",
      createdAt: lockedRuntimeSnapshot.createdAt,
      commercialContract: {
        billingCycle: "monthly",
        contractStart: lockedRuntimeSnapshot.effectiveAt,
        contractEnd: lockedRuntimeSnapshot.expiresAt,
      },
    };
  }
  const { cycleStart } = await resolveEnterpriseCreditsResetWindow(
    input.enterpriseId,
    at,
    { subscriptions: input.storePaths?.subscriptions },
    lockedSubForCycle,
  );

  // 原子预约+扣减 included（锁内拆账，防多 taskId 并发 over-include）
  // Enterprise BYOK：不扣平台 Credits 桶 / PAYG，仅记账 provenance + provider cost。
  let paygSplit: PaygCreditSplit = {
    includedCredits: creditsCharged,
    overageCredits: 0,
    overageAmountCents: 0,
  };
  if (enterpriseByok) {
    paygSplit = {
      includedCredits: 0,
      overageCredits: 0,
      overageAmountCents: 0,
    };
  } else if (monthlyCredits > 0 && creditsCharged > 0) {
    const subscriptionSnapshotId = snapshotId ?? activeRuntimeSnapshot?.id;
    await ensurePlanCycleCreditBucket(
      {
        enterpriseId: input.enterpriseId,
        cycleStart,
        monthlyCredits,
        subscriptionSnapshotId,
      },
      input.storePaths?.creditBuckets,
    );
    await syncPlanCycleBucketFromLegacyBalance(
      {
        enterpriseId: input.enterpriseId,
        cycleStart,
        subscriptionSnapshotId,
      },
      {
        creditBuckets: input.storePaths?.creditBuckets,
        tenantCredits: input.storePaths?.tenantCredits,
      },
    );
    if (overagePolicyType === "pay_as_you_go") {
      // 配置已在上方校验：allowMeterOverage + extra 价缺一即拒
      const reserved = await reserveAndDebitCreditsForTask(
        {
          enterpriseId: input.enterpriseId,
          cycleStart,
          creditsRequested: creditsCharged,
          taskId,
          overageUnitPriceCents,
          allowOverage: allowMeterOverage,
        },
        input.storePaths?.creditBuckets,
      );
      paygSplit = {
        includedCredits: reserved.includedCredits,
        overageCredits: reserved.overageCredits,
        overageAmountCents: reserved.overageAmountCents,
      };
    } else {
      // block / credits_only：全额扣桶；不足应在 authorize 拒绝，此处仍严格扣减
      const reserved = await reserveAndDebitCreditsForTask(
        {
          enterpriseId: input.enterpriseId,
          cycleStart,
          creditsRequested: creditsCharged,
          taskId,
          overageUnitPriceCents,
          allowOverage: false,
        },
        input.storePaths?.creditBuckets,
      );
      paygSplit = {
        includedCredits: reserved.includedCredits,
        overageCredits: 0,
        overageAmountCents: 0,
      };
    }
  } else {
    paygSplit = splitPaygCredits({
      creditsCharged,
      creditsRemaining: 0,
      overageUnitPriceCents,
      overagePolicyType,
    });
  }
  const stagePath = input.storePaths?.creditUsageStages;
  const priorStage = await getCreditUsageStage(input.enterpriseId, taskId, stagePath);
  if (priorStage?.stage === "done") {
    const existingLedger = await getUsageLedgerEntryByTaskId(
      input.enterpriseId,
      taskId,
      input.storePaths?.usageLedger,
    );
    return {
      recorded: false,
      deduped: true,
      creditsCharged: existingLedger?.creditsCharged ?? priorStage.creditsCharged,
      includedCredits: existingLedger?.includedCredits,
      overageCredits: existingLedger?.overageCredits,
      overageAmountCents: existingLedger?.overageAmountCents,
      tier: existingLedger?.tier ?? tier,
      providerCostCents: existingLedger?.providerCostCents ?? providerCostCents,
      tenantRevenueCents: existingLedger?.tenantRevenueCents ?? tenantRevenueCents,
      skippedConsumption: priorStage.skippedConsumption ?? monthlyCredits <= 0,
      stage: "done",
      resumed: false,
    };
  }
  const resumed = Boolean(priorStage && priorStage.stage !== "pending");
  let stage: CreditUsageStage = priorStage?.stage ?? "pending";

  const advance = async (
    next: CreditUsageStage,
    extra?: { skippedConsumption?: boolean },
  ): Promise<void> => {
    await upsertCreditUsageStage(
      {
        enterpriseId: input.enterpriseId,
        taskId,
        stage: next,
        creditsCharged,
        cycleStart,
        ...(extra?.skippedConsumption !== undefined
          ? { skippedConsumption: extra.skippedConsumption }
          : {}),
      },
      stagePath,
    );
    stage = next;
  };

  // ── ledger_written ──
  let ledgerEntry = await getUsageLedgerEntryByTaskId(
    input.enterpriseId,
    taskId,
    input.storePaths?.usageLedger,
  );
  if (!stageAtLeast(stage, "ledger_written") || !ledgerEntry) {
    const ledgerResult = await appendUsageLedgerEntry(
      {
        enterpriseId: input.enterpriseId,
        taskId,
        modelId,
        ...(enterpriseByok || modelId.trim().startsWith("ent/")
          ? { source: "enterprise" as const, billingOwner: "enterprise" as const }
          : { source: "platform" as const, billingOwner: "platform" as const }),
        tier,
        policyId: input.policyId.trim() || "balanced",
        planId: planId!,
        planVersionId: planVersionId,
        subscriptionId: subscriptionId!,
        subscriptionSnapshotId: snapshotId ?? activeRuntimeSnapshot?.id ?? undefined,
        runId: input.runId?.trim() ?? taskId,
        authorizationDecisionId: input.authorizationDecisionId?.trim(),
        userId: input.userId?.trim(),
        billingSeatId: input.billingSeatId?.trim(),
        orgSeatId: input.orgSeatId?.trim() ?? attribution.orgSeatId,
        botId: input.botId?.trim(),
        creditsCharged,
        includedCredits: paygSplit.includedCredits,
        overageCredits: paygSplit.overageCredits,
        overageAmountCents: paygSplit.overageAmountCents,
        pricingEngine,
        providerCostCents,
        tenantRevenueCents,
        ...(input.tokenUsage?.inputTokens !== undefined
          ? { inputTokens: input.tokenUsage.inputTokens }
          : {}),
        ...(input.tokenUsage?.outputTokens !== undefined
          ? { outputTokens: input.tokenUsage.outputTokens }
          : {}),
        ...(input.toolCallCount !== undefined
          ? { toolCallCount: Math.max(0, Math.floor(input.toolCallCount)) }
          : {}),
        ...(input.durationMs !== undefined
          ? { durationMs: Math.max(0, Math.floor(input.durationMs)) }
          : {}),
        ...(input.retryCount !== undefined
          ? { retryCount: Math.max(0, Math.floor(input.retryCount)) }
          : {}),
        ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
      },
      input.storePaths?.usageLedger,
    );
    ledgerEntry = ledgerResult.entry;
    await advance("ledger_written");
  }

  const charged = ledgerEntry?.creditsCharged ?? creditsCharged;
  const included = ledgerEntry?.includedCredits ?? paygSplit.includedCredits;
  const overageQty = ledgerEntry?.overageCredits ?? paygSplit.overageCredits;
  const overageCents = ledgerEntry?.overageAmountCents ?? paygSplit.overageAmountCents;
  let skippedConsumption = enterpriseByok || monthlyCredits <= 0 || included <= 0;

  // ── bucket_debited：扣减已在 reserveAndDebitCreditsForTask 原子完成（幂等）──
  // BYOK 跳过扣桶，仍推进阶段机以保持幂等重放一致。
  if (!stageAtLeast(stage, "bucket_debited")) {
    skippedConsumption = enterpriseByok || monthlyCredits <= 0 || included <= 0;
    await advance("bucket_debited", { skippedConsumption });
  }

  // ── tenant_projected（taskId 幂等）──
  if (!stageAtLeast(stage, "tenant_projected")) {
    if (!enterpriseByok && monthlyCredits > 0 && included > 0) {
      await ensureTenantCreditsAllocation(
        {
          enterpriseId: input.enterpriseId,
          cycleStart,
          monthlyCredits,
        },
        input.storePaths?.tenantCredits,
      );
      await consumeTenantCredits(
        {
          enterpriseId: input.enterpriseId,
          cycleStart,
          credits: included,
          taskId,
          allowPartial: overagePolicyType === "pay_as_you_go",
        },
        input.storePaths?.tenantCredits,
      );
    }
    await advance("tenant_projected", { skippedConsumption });
  }

  // ── usage_record（eventId=taskId 幂等）：全量 credits 进用量，供 final Bill meter 拆 included/overage ──
  if (!stageAtLeast(stage, "usage_record")) {
    if (enterpriseByok && providerCostCents > 0) {
      // BYOK：只记企业侧 provider cost，不进平台 ai_credits 用量（避免误开 PAYG 账单）
      await recordUsage(
        {
          enterpriseId: input.enterpriseId,
          userId: input.userId?.trim() || "system",
          eventId: `byok-provider-cost:${taskId}`,
          key: "ai_provider_cost",
          quantity: providerCostCents,
          occurredAt: input.occurredAt,
          agentId: attribution.agentId,
          orgSeatId: attribution.orgSeatId,
        },
        input.storePaths?.usage,
      );
    } else if (monthlyCredits <= 0 && providerCostCents > 0) {
      await recordUsage(
        {
          enterpriseId: input.enterpriseId,
          userId: input.userId?.trim() || "system",
          eventId: `provider-cost:${taskId}`,
          key: "ai_provider_cost",
          quantity: providerCostCents,
          occurredAt: input.occurredAt,
          agentId: attribution.agentId,
          orgSeatId: attribution.orgSeatId,
        },
        input.storePaths?.usage,
      );
    }
    if (!enterpriseByok && monthlyCredits > 0 && charged > 0) {
      // 全量 creditsCharged 进用量 → final Bill 由 meter 按 includedQuota 拆 included/overage
      await recordUsage(
        {
          enterpriseId: input.enterpriseId,
          userId: input.userId?.trim() || "system",
          eventId: usageEventId(taskId),
          key: "ai_credits",
          quantity: charged,
          occurredAt: input.occurredAt,
          agentId: attribution.agentId,
          orgSeatId: attribution.orgSeatId,
        },
        input.storePaths?.usage,
      );
    }
    await advance("usage_record", { skippedConsumption });
  }

  // ── event_published ──
  if (!stageAtLeast(stage, "event_published")) {
    if (enterpriseByok && providerCostCents > 0) {
      await billingEventBus.publish({
        type: "usage.reported",
        enterpriseId: input.enterpriseId,
        userId: input.userId?.trim() || "system",
        eventId: `byok-provider-cost:${taskId}`,
        key: "ai_provider_cost",
        quantity: providerCostCents,
        occurredAt: input.occurredAt ?? new Date().toISOString(),
        ...(attribution.agentId ? { agentId: attribution.agentId } : {}),
        ...(attribution.orgSeatId ? { orgSeatId: attribution.orgSeatId } : {}),
      });
    } else if (monthlyCredits <= 0 && providerCostCents > 0) {
      await billingEventBus.publish({
        type: "usage.reported",
        enterpriseId: input.enterpriseId,
        userId: input.userId?.trim() || "system",
        eventId: `provider-cost:${taskId}`,
        key: "ai_provider_cost",
        quantity: providerCostCents,
        occurredAt: input.occurredAt ?? new Date().toISOString(),
        ...(attribution.agentId ? { agentId: attribution.agentId } : {}),
        ...(attribution.orgSeatId ? { orgSeatId: attribution.orgSeatId } : {}),
      });
    }
    if (!enterpriseByok && monthlyCredits > 0 && charged > 0) {
      await billingEventBus.publish({
        type: "usage.reported",
        enterpriseId: input.enterpriseId,
        userId: input.userId?.trim() || "system",
        eventId: usageEventId(taskId),
        key: "ai_credits",
        quantity: charged,
        occurredAt: input.occurredAt ?? new Date().toISOString(),
        ...(attribution.agentId ? { agentId: attribution.agentId } : {}),
        ...(attribution.orgSeatId ? { orgSeatId: attribution.orgSeatId } : {}),
      });
    }
    await advance("event_published", { skippedConsumption });
  }

  await advance("done", { skippedConsumption });

  return {
    recorded: true,
    deduped: false,
    creditsCharged: charged,
    includedCredits: included,
    overageCredits: overageQty,
    overageAmountCents: overageCents,
    tier: ledgerEntry?.tier ?? tier,
    providerCostCents: ledgerEntry?.providerCostCents ?? providerCostCents,
    tenantRevenueCents: ledgerEntry?.tenantRevenueCents ?? tenantRevenueCents,
    skippedConsumption,
    stage: "done",
    resumed,
  };
}

export async function resolveEnterpriseEconomics(
  enterpriseId: string,
  storePaths?: CreditUsageStorePaths,
  now: Date = new Date(),
) {
  // 经营汇总可按消费出账窗；若需与 Credits 桶对齐请改用 credits_reset
  const { cycleStart, cycleEnd } = await resolveEnterpriseCreditsResetWindow(enterpriseId, now, {
    subscriptions: storePaths?.subscriptions,
  });
  const entries = await listUsageLedgerEntries(
    enterpriseId,
    { startTime: cycleStart, endTime: cycleEnd },
    storePaths?.usageLedger,
  );
  return {
    cycleStart,
    cycleEnd,
    ...aggregateLedgerEconomics(entries),
    byPricingEngine: aggregateLedgerEconomicsByPricingEngine(entries),
  };
}

export async function resolveTenantCreditsStatus(
  enterpriseId: string,
  storePaths?: CreditUsageStorePaths,
  now: Date = new Date(),
): Promise<{
  monthlyCredits: number;
  creditsConsumed: number;
  creditsRemaining: number;
  cycleStart: string;
} | null> {
  const subscription = await getActiveSubscription(enterpriseId, storePaths?.subscriptions);
  if (!subscription) {
    return null;
  }
  const entitlement = await getPlanEntitlementSnapshot(
    subscription.planVersionId,
    storePaths?.entitlementSnapshot,
  );
  const monthlyCredits = entitlement?.monthlyCredits ?? 0;
  // 状态查询用 active 订阅的 Credits 重置窗（monthly），不是年付合同窗
  const { cycleStart } = await resolveEnterpriseCreditsResetWindow(enterpriseId, now, {
    subscriptions: storePaths?.subscriptions,
  });

  const buckets = await listCreditBucketsForCycle(
    enterpriseId,
    cycleStart,
    storePaths?.creditBuckets,
  );
  if (buckets.length > 0) {
    const bucketSummary = await summarizeCreditBucketsForCycle(
      enterpriseId,
      cycleStart,
      storePaths?.creditBuckets,
    );
    return {
      monthlyCredits: bucketSummary.monthlyCredits,
      creditsConsumed: bucketSummary.creditsConsumed,
      creditsRemaining: bucketSummary.creditsRemaining,
      cycleStart,
    };
  }

  if (monthlyCredits <= 0) {
    return {
      monthlyCredits: 0,
      creditsConsumed: 0,
      creditsRemaining: 0,
      cycleStart,
    };
  }

  const balance = await ensureTenantCreditsAllocation(
    { enterpriseId, cycleStart, monthlyCredits },
    storePaths?.tenantCredits,
  );
  return {
    monthlyCredits: balance.monthlyCredits,
    creditsConsumed: balance.creditsConsumed,
    creditsRemaining: balance.creditsRemaining,
    cycleStart: balance.cycleStart,
  };
}
