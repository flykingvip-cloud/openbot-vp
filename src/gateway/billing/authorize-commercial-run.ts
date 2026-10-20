/**
 * authorizeCommercialRun — 所有 AI 执行前统一商业闸口（P0）。
 *
 * 编排：订阅状态 → runtime snapshot → 预算/配额/并发 → agent-run-registry 占槽。
 * P1 扩展：Burst/Queue/PAYG、Seat Entitlement、OverAllocation。
 */

import { randomUUID } from "node:crypto";
import { buildModelEntitlementEmptyUserMessage } from "../../agents/model-fallback.js";
import {
  resolveEmployeeModelGate,
  type EmployeeModelGateInput,
} from "../model-entitlement/employee-model-gate.js";
import type { EmployeeModelGateResult } from "../model-entitlement/employee-model-gate.js";
import { resolveTenantLifecycleAccess } from "../platform-auth/resolve-tenant-lifecycle-access.js";
import { acquireAgentRunSlotWithQueuePolicy } from "./agent-run-queue.js";
import { countActiveAgentRuns, finishAgentRun } from "./agent-run-registry.js";
import { evaluateAssetBudget, evaluateAssetPause } from "./asset-run-gate.js";
import { countActiveBots } from "./bot-resources-store.js";
import { checkEntitlementConstraints, type ConstraintReason } from "./constraint-engine.js";
import {
  sumHeldReservationsForEnterprise,
  tryHoldCreditReservation,
} from "./credit-reservation-store.js";
import { enforceCostControl } from "./enforce.js";
import {
  estimateCreditReservation,
  paygOveragePreflightAllowed,
} from "./estimate-credit-reservation.js";
import {
  getOverAllocationState,
  isActionBlockedByOverAllocation,
} from "./over-allocation-store.js";
import { getPlanVersion } from "./plans-store.js";
import { resolveTenantCreditsStatus } from "./record-credit-usage.js";
import { resolveBillingSeatForCommercialRun } from "./resolve-billing-seat-for-commercial-run.js";
import { resolveEnterpriseIdForAgentRun } from "./resolve-enterprise-id-for-agent-run.js";
import { resolveSeatConcurrencyCap } from "./resolve-seat-concurrency-cap.js";
import {
  assertCommercialSeatProfileAligned,
  resolveSeatEntitlementProfileForSeat,
} from "./resolve-seat-entitlement-profile-for-seat.js";
import { getActiveSubscriptionRuntimeSnapshot } from "./subscription-runtime-snapshots-store.js";
import { materializeSubscriptionRuntimeSnapshot } from "./subscription-transition-engine.js";
import { getActiveSubscription } from "./subscriptions-store.js";

export type CommercialRunAction = "agent_run" | "bot_create";

/** P1 扩展 queue / pay_as_you_go；P0 仅 block。 */
export type ConcurrencyDecision = {
  allowed: boolean;
  activeCount: number;
  limit: number;
  mode: "block" | "queue" | "pay_as_you_go";
  reason?: ConstraintReason;
};

export type CreditDecision = {
  allowed: boolean;
  creditsRemaining: number;
  required?: number;
  billingMode: "credits" | "enterprise_budget";
  /**
   * overagePolicy.type === pay_as_you_go 且额度不足时仍 allowed=true，
   * 标记本次运行将产生货币超额路径。
   */
  overageAllowed?: boolean;
  overagePolicyType?: "block" | "credits_only" | "pay_as_you_go";
};

export type PolicyDecision = {
  allowed: boolean;
  reason?: string;
};

export type AuthorizeCommercialRunInput = {
  runId?: string;
  enterpriseId?: string;
  agentId?: string;
  botId?: string;
  userId?: string;
  billingSeatId?: string;
  orgSeatId?: string;
  action: CommercialRunAction;
  creditsRequired?: number;
  /** agent_run 路径：传入以校验 employee model gate。 */
  modelGateInput?: EmployeeModelGateInput;
  /**
   * Collaboration group id when the run already knows it.
   * Channel session keys are not collaboration ids and must not be passed here.
   */
  groupId?: string;
  storePaths?: {
    subscriptions?: string;
    runtimeSnapshots?: string;
    plans?: string;
    entitlementSnapshot?: string;
    modelBinding?: string;
    agentRunRegistry?: string;
    agentRunQueue?: string;
    botResources?: string;
    overAllocation?: string;
    seats?: string;
    seatEntitlementAssignments?: string;
    usage?: string;
  };
};

export type AuthorizeCommercialRunAllowed = {
  allowed: true;
  skipped: false;
  authorizationDecisionId: string;
  enterpriseId: string;
  subscriptionId: string;
  planId: string;
  planVersionId: string;
  subscriptionSnapshotId: string;
  policyDecision: PolicyDecision;
  creditDecision: CreditDecision;
  concurrencyDecision: ConcurrencyDecision;
  modelGate?: EmployeeModelGateResult;
  slotAcquired: boolean;
  /** Preflight credit hold amount (0 = no hold). */
  creditReservation?: { reservedCredits: number; runId: string };
};

export type AuthorizeCommercialRunDenied = {
  allowed: false;
  skipped: false;
  authorizationDecisionId: string;
  enterpriseId: string;
  reason:
    | ConstraintReason
    | "BUDGET_EXCEEDED"
    | "MODEL_GATE_DENIED"
    | "NO_SUBSCRIPTION"
    | "OVER_ALLOCATED"
    | "SEAT_CONCURRENCY_LIMIT_EXCEEDED"
    | "CONCURRENCY_QUEUE_TIMEOUT"
    | "TENANT_EXPIRED"
    | "TENANT_SUSPENDED"
    | "ASSET_PAUSED"
    | "ASSET_BUDGET_EXCEEDED";
  message: string;
  policyDecision: PolicyDecision;
  creditDecision?: CreditDecision;
  concurrencyDecision?: ConcurrencyDecision;
};

export type AuthorizeCommercialRunSkipped = {
  allowed: false;
  skipped: true;
};

export type AuthorizeCommercialRunResult =
  | AuthorizeCommercialRunAllowed
  | AuthorizeCommercialRunDenied
  | AuthorizeCommercialRunSkipped;

function gateActionFor(action: CommercialRunAction): "ai" | "bot" {
  return action === "bot_create" ? "bot" : "ai";
}

/**
 * 统一商业运行授权。
 * - 无企业作用域（无法解析 enterpriseId）→ skipped（非企业路径 fail-open）
 * - 有企业作用域但无 active 订阅 → hard deny（NO_SUBSCRIPTION）
 */
export async function authorizeCommercialRun(
  input: AuthorizeCommercialRunInput,
): Promise<AuthorizeCommercialRunResult> {
  const authorizationDecisionId = `auth-${randomUUID()}`;
  const enterpriseId = await resolveEnterpriseIdForAgentRun({
    enterpriseId: input.enterpriseId,
    agentId: input.agentId,
  });

  if (!enterpriseId) {
    return { allowed: false, skipped: true };
  }

  // 租户生命周期硬闸口：到期（试用/订阅过期、宽限期已过）或被暂停的企业，
  // 在任何订阅/配额判断之前直接拦截运行。fail-open：平台鉴权未启用/租户未知/读取失败时不拦。
  const lifecycle = await resolveTenantLifecycleAccess(enterpriseId);
  if (lifecycle.blocked) {
    return {
      allowed: false,
      skipped: false,
      authorizationDecisionId,
      enterpriseId,
      reason: lifecycle.reason === "suspended" ? "TENANT_SUSPENDED" : "TENANT_EXPIRED",
      message: lifecycle.message ?? "该企业当前无法执行 AI 任务。",
      policyDecision: {
        allowed: false,
        ...(lifecycle.message ? { reason: lifecycle.message } : {}),
      },
    };
  }

  const assetPause = await evaluateAssetPause({
    enterpriseId,
    agentId: input.agentId,
    groupId: input.groupId,
  });
  if (assetPause.blocked) {
    return {
      allowed: false,
      skipped: false,
      authorizationDecisionId,
      enterpriseId,
      reason: assetPause.reason,
      message: assetPause.message,
      policyDecision: { allowed: false, reason: assetPause.message },
    };
  }

  const subscription = await getActiveSubscription(enterpriseId, input.storePaths?.subscriptions);
  if (!subscription) {
    return {
      allowed: false,
      skipped: false,
      authorizationDecisionId,
      enterpriseId,
      reason: "NO_SUBSCRIPTION",
      message: "当前企业没有生效订阅，无法执行该操作。请先订阅或续费。",
      policyDecision: { allowed: true },
    };
  }

  const assetBudget = await evaluateAssetBudget({
    enterpriseId,
    agentId: input.agentId,
    subscription,
    plansPath: input.storePaths?.plans,
    usagePath: input.storePaths?.usage,
  });
  if (assetBudget.blocked) {
    return {
      allowed: false,
      skipped: false,
      authorizationDecisionId,
      enterpriseId,
      reason: assetBudget.reason,
      message: assetBudget.message,
      policyDecision: { allowed: false, reason: assetBudget.message },
    };
  }

  let runtimeSnapshot = await getActiveSubscriptionRuntimeSnapshot(
    enterpriseId,
    input.storePaths?.runtimeSnapshots,
  );
  if (!runtimeSnapshot) {
    runtimeSnapshot = await materializeSubscriptionRuntimeSnapshot({
      enterpriseId,
      subscription,
      storePaths: {
        plans: input.storePaths?.plans,
        entitlementSnapshot: input.storePaths?.entitlementSnapshot,
        modelBinding: input.storePaths?.modelBinding,
        runtimeSnapshots: input.storePaths?.runtimeSnapshots,
      },
    });
  }

  const entitlement = runtimeSnapshot.entitlementSnapshot;
  const creditsStatus = await resolveTenantCreditsStatus(enterpriseId, input.storePaths);
  const heldReserved = await sumHeldReservationsForEnterprise(
    enterpriseId,
    (input.storePaths as { creditReservations?: string } | undefined)?.creditReservations,
  );
  const rawRemaining = creditsStatus?.creditsRemaining ?? entitlement.monthlyCredits;
  const creditsRemaining = Math.max(0, rawRemaining - heldReserved);

  const budgetGate = await enforceCostControl({
    enterpriseId,
    action: gateActionFor(input.action),
  });
  const policyDecision: PolicyDecision = {
    allowed: budgetGate.allowed,
    ...(budgetGate.allowed ? {} : { reason: budgetGate.reason }),
  };
  if (!budgetGate.allowed) {
    return {
      allowed: false,
      skipped: false,
      authorizationDecisionId,
      enterpriseId,
      reason: "BUDGET_EXCEEDED",
      message: budgetGate.reason,
      policyDecision,
    };
  }

  const creditDecision: CreditDecision = {
    allowed: true,
    creditsRemaining,
    billingMode: runtimeSnapshot.billingMode,
    ...(input.creditsRequired !== undefined ? { required: input.creditsRequired } : {}),
  };

  const activeBotCount = await countActiveBots(enterpriseId, input.storePaths?.botResources);
  const activeRunCount = await countActiveAgentRuns(
    enterpriseId,
    input.storePaths?.agentRunRegistry,
  );

  const overAllocation = await getOverAllocationState(
    enterpriseId,
    input.storePaths?.overAllocation,
  );

  if (input.action === "bot_create") {
    if (isActionBlockedByOverAllocation(overAllocation, "create_bot")) {
      return {
        allowed: false,
        skipped: false,
        authorizationDecisionId,
        enterpriseId,
        reason: "OVER_ALLOCATED",
        message: "当前订阅处于超配治理状态，无法新建 Bot。请先清理超额席位或 Bot，或升级套餐。",
        policyDecision,
        creditDecision,
      };
    }
    const botCheck = checkEntitlementConstraints({
      snapshot: {
        maxBots: entitlement.maxBots,
        maxConcurrentRuns: entitlement.maxConcurrentRuns,
        monthlyCredits: entitlement.monthlyCredits,
        overagePolicy: entitlement.overagePolicy,
      },
      activeBotCount,
      activeRunCount,
      creditsRemaining,
      botCreateAttempt: true,
      runStartAttempt: false,
      creditsChargeAttempt: false,
    });
    if (!botCheck.allowed) {
      return {
        allowed: false,
        skipped: false,
        authorizationDecisionId,
        enterpriseId,
        reason: botCheck.reason,
        message: botCheck.message,
        policyDecision,
        creditDecision,
      };
    }
    return {
      allowed: true,
      skipped: false,
      authorizationDecisionId,
      enterpriseId,
      subscriptionId: subscription.id,
      planId: subscription.planId,
      planVersionId: subscription.planVersionId,
      subscriptionSnapshotId: runtimeSnapshot.id,
      policyDecision,
      creditDecision,
      concurrencyDecision: {
        allowed: true,
        activeCount: activeRunCount,
        limit: entitlement.maxConcurrentRuns,
        mode: "block",
      },
      slotAcquired: false,
    };
  }

  // agent_run path
  const billingSeat = await resolveBillingSeatForCommercialRun({
    enterpriseId,
    billingSeatId: input.billingSeatId,
    userId: input.userId ?? input.modelGateInput?.gatewayClientUser,
    botId: input.botId,
    agentId: input.agentId,
    storePaths: {
      seats: input.storePaths?.seats,
      botResources: input.storePaths?.botResources,
    },
  });
  const seatConcurrencyCap = billingSeat
    ? await resolveSeatConcurrencyCap({
        enterpriseId,
        seat: billingSeat,
        tenantMaxConcurrentRuns: entitlement.maxConcurrentRuns,
        seatEntitlementAssignmentsPath: input.storePaths?.seatEntitlementAssignments,
      })
    : null;

  const billingSeatProfile = billingSeat
    ? await resolveSeatEntitlementProfileForSeat({
        tenantId: enterpriseId,
        seatId: billingSeat.id,
        seatEntitlementAssignmentsPath: input.storePaths?.seatEntitlementAssignments,
        seatsStorePath: input.storePaths?.seats,
      })
    : null;

  let modelGate: EmployeeModelGateResult | undefined;
  if (input.modelGateInput) {
    modelGate = await resolveEmployeeModelGate({
      ...input.modelGateInput,
      // Authoritative commercial-layer enterprise id — must not be lost on gate entry.
      enterpriseIdHint: enterpriseId,
      ...(billingSeat
        ? {
            commercialBillingSeatId: billingSeat.id,
            seatEntitlementProfileIdOverride: billingSeatProfile?.profileId,
            billingSeatsStorePath:
              input.modelGateInput.billingSeatsStorePath ?? input.storePaths?.seats,
            seatEntitlementAssignmentsPath:
              input.modelGateInput.seatEntitlementAssignmentsPath ??
              input.storePaths?.seatEntitlementAssignments,
          }
        : {}),
    });
    if (
      billingSeatProfile &&
      modelGate.seatEntitlementProfileId &&
      !assertCommercialSeatProfileAligned(
        billingSeatProfile.profileId,
        modelGate.seatEntitlementProfileId,
      )
    ) {
      return {
        allowed: false,
        skipped: false,
        authorizationDecisionId,
        enterpriseId,
        reason: "MODEL_GATE_DENIED",
        message: "席位商业档位校验不一致，无法执行 AI 任务。",
        policyDecision,
        creditDecision,
      };
    }
    if (modelGate.allowlist !== undefined && modelGate.allowlist.length === 0) {
      return {
        allowed: false,
        skipped: false,
        authorizationDecisionId,
        enterpriseId,
        reason: "MODEL_GATE_DENIED",
        message:
          buildModelEntitlementEmptyUserMessage(modelGate.entitlementHint) ||
          "当前席位无可用模型授权，无法执行 AI 任务。",
        policyDecision,
        creditDecision,
      };
    }
  }

  // Preflight reservation: estimate from catalog weight / meter — never skip credit hold
  // for credits-mode agent runs (block/credits_only must zero-egress when short).
  const preferredModelId =
    input.modelGateInput && modelGate?.allowlist && modelGate.allowlist.length > 0
      ? modelGate.allowlist[0]
      : undefined;
  const estimate = await estimateCreditReservation({
    enterpriseId,
    billingMode: runtimeSnapshot.billingMode,
    entitlement,
    ...(preferredModelId ? { modelId: preferredModelId } : {}),
    storePaths: {
      creditWeights: (input.storePaths as { creditWeights?: string } | undefined)?.creditWeights,
      modelCatalog: (input.storePaths as { modelCatalog?: string } | undefined)?.modelCatalog,
    },
  });
  const creditsRequired = Math.max(
    estimate.reservedCredits,
    Math.max(0, Math.floor(input.creditsRequired ?? 0)),
  );
  creditDecision.required = creditsRequired > 0 ? creditsRequired : creditDecision.required;

  const runCheck = checkEntitlementConstraints({
    snapshot: {
      maxBots: entitlement.maxBots,
      maxConcurrentRuns: entitlement.maxConcurrentRuns,
      monthlyCredits: entitlement.monthlyCredits,
      overagePolicy: entitlement.overagePolicy,
    },
    activeBotCount,
    activeRunCount,
    creditsRemaining,
    botCreateAttempt: false,
    runStartAttempt: true,
    creditsChargeAttempt: runtimeSnapshot.billingMode === "credits" && creditsRequired > 0,
    creditsRequired,
  });

  creditDecision.overagePolicyType = entitlement.overagePolicy?.type ?? "block";
  if (!runCheck.allowed && runCheck.reason === "CREDITS_EXHAUSTED") {
    creditDecision.allowed = false;
    creditDecision.overageAllowed = false;
    return {
      allowed: false,
      skipped: false,
      authorizationDecisionId,
      enterpriseId,
      reason: runCheck.reason,
      message: runCheck.message,
      policyDecision,
      creditDecision,
    };
  }
  if (runCheck.allowed && "creditsOverage" in runCheck && runCheck.creditsOverage) {
    // PAYG preflight: planVersion.snapshot.meters + snapshot.pricing extra price.
    const planVersion = await getPlanVersion(subscription.planVersionId, input.storePaths?.plans);
    const meters = planVersion?.snapshot?.meters;
    const pricing = planVersion?.snapshot?.pricing ?? [];
    const meter = meters?.find((m) => m.key === "ai_credits");
    const extra = pricing.find((row) => row.type === "extra" && row.key === "ai_credits");
    const payg = paygOveragePreflightAllowed({
      overagePolicyType: entitlement.overagePolicy?.type,
      meterAllowOverage: meter?.allowOverage,
      extraUnitPriceCents: extra?.priceCents ?? null,
    });
    if (!payg.allowed) {
      creditDecision.allowed = false;
      creditDecision.overageAllowed = false;
      return {
        allowed: false,
        skipped: false,
        authorizationDecisionId,
        enterpriseId,
        reason: "CREDITS_EXHAUSTED",
        message: payg.reason ?? "PAYG 超额预检失败。",
        policyDecision,
        creditDecision,
      };
    }
    creditDecision.allowed = true;
    creditDecision.overageAllowed = true;
  }

  const concurrencyPolicy = entitlement.concurrencyPolicy;
  const tenantBurstCap = concurrencyPolicy?.maxBurstRuns ?? entitlement.maxConcurrentRuns;
  const concurrencyDecision: ConcurrencyDecision = {
    allowed: true,
    activeCount: activeRunCount,
    limit: tenantBurstCap,
    mode: concurrencyPolicy?.mode ?? "block",
  };

  let slotAcquired = false;
  const runId = input.runId?.trim();
  if (runId) {
    const slot = await acquireAgentRunSlotWithQueuePolicy(
      {
        runId,
        enterpriseId,
        maxConcurrentRuns: entitlement.maxConcurrentRuns,
        maxBurstRuns: tenantBurstCap,
        allowBurstConcurrency: entitlement.overagePolicy.allowBurstConcurrency,
        concurrencyMode: concurrencyPolicy?.mode,
        ...(input.agentId?.trim() ? { agentId: input.agentId.trim() } : {}),
        ...(input.botId?.trim() ? { botId: input.botId.trim() } : {}),
        ...(seatConcurrencyCap
          ? {
              billingSeatId: seatConcurrencyCap.billingSeatId,
              seatMaxConcurrentRuns: seatConcurrencyCap.seatMaxConcurrentRuns,
            }
          : {}),
      },
      {
        registryStorePath: input.storePaths?.agentRunRegistry,
        queueStorePath: input.storePaths?.agentRunQueue,
      },
    );
    if (!slot.ok) {
      if (slot.reason === "DUPLICATE_ACTIVE") {
        slotAcquired = true;
      } else if (slot.reason === "CONCURRENCY_QUEUE_TIMEOUT") {
        concurrencyDecision.allowed = false;
        concurrencyDecision.reason = "CONCURRENCY_LIMIT_EXCEEDED";
        return {
          allowed: false,
          skipped: false,
          authorizationDecisionId,
          enterpriseId,
          reason: "CONCURRENCY_QUEUE_TIMEOUT",
          message: `并发排队超时（已等待 ${Math.round(slot.waitedMs / 1000)} 秒）。请稍后重试或升级套餐并发。`,
          policyDecision,
          creditDecision,
          concurrencyDecision,
        };
      } else if (slot.reason === "SEAT_CONCURRENCY_LIMIT_EXCEEDED") {
        concurrencyDecision.allowed = false;
        concurrencyDecision.reason = "CONCURRENCY_LIMIT_EXCEEDED";
        return {
          allowed: false,
          skipped: false,
          authorizationDecisionId,
          enterpriseId,
          reason: "SEAT_CONCURRENCY_LIMIT_EXCEEDED",
          message: `该席位并发 AI 任务已达上限（同时 ${seatConcurrencyCap?.seatMaxConcurrentRuns ?? 1} 个）。请稍后再试或升级席位档位。`,
          policyDecision,
          creditDecision,
          concurrencyDecision,
        };
      } else {
        concurrencyDecision.allowed = false;
        concurrencyDecision.reason = "CONCURRENCY_LIMIT_EXCEEDED";
        return {
          allowed: false,
          skipped: false,
          authorizationDecisionId,
          enterpriseId,
          reason: "CONCURRENCY_LIMIT_EXCEEDED",
          message: `并发 AI 任务已达上限（同时 ${entitlement.maxConcurrentRuns} 个）。请稍后再试或升级套餐。`,
          policyDecision,
          creditDecision,
          concurrencyDecision,
        };
      }
    } else {
      slotAcquired = true;
    }
  } else if (!runCheck.allowed && runCheck.reason === "CONCURRENCY_LIMIT_EXCEEDED") {
    concurrencyDecision.allowed = false;
    concurrencyDecision.reason = runCheck.reason;
    return {
      allowed: false,
      skipped: false,
      authorizationDecisionId,
      enterpriseId,
      reason: runCheck.reason,
      message: runCheck.message,
      policyDecision,
      creditDecision,
      concurrencyDecision,
    };
  }

  let creditReservation: { reservedCredits: number; runId: string } | undefined;
  const runIdForReserve = input.runId?.trim();
  if (runIdForReserve && creditsRequired > 0 && slotAcquired) {
    // Atomic check+hold under reservation store lock (prevents concurrent double-spend).
    const hold = await tryHoldCreditReservation({
      runId: runIdForReserve,
      enterpriseId,
      authorizationDecisionId,
      subscriptionId: subscription.id,
      subscriptionSnapshotId: runtimeSnapshot.id,
      planId: subscription.planId,
      planVersionId: subscription.planVersionId,
      reservedCredits: creditsRequired,
      availableCredits: rawRemaining,
      allowOverage: creditDecision.overageAllowed === true,
      storePath: (input.storePaths as { creditReservations?: string } | undefined)
        ?.creditReservations,
    });
    if (!hold.ok) {
      await finishAgentRun(runIdForReserve, input.storePaths?.agentRunRegistry);
      creditDecision.allowed = false;
      creditDecision.overageAllowed = false;
      return {
        allowed: false,
        skipped: false,
        authorizationDecisionId,
        enterpriseId,
        reason: "CREDITS_EXHAUSTED",
        message: `Credits 不足（可用 ${hold.available}，已预约 ${hold.held}，需要 ${hold.required}）。`,
        policyDecision,
        creditDecision,
        concurrencyDecision: {
          ...concurrencyDecision,
          allowed: true,
        },
      };
    }
    creditReservation = {
      reservedCredits: hold.reservation.reservedCredits,
      runId: runIdForReserve,
    };
  }

  return {
    allowed: true,
    skipped: false,
    authorizationDecisionId,
    enterpriseId,
    subscriptionId: subscription.id,
    planId: subscription.planId,
    planVersionId: subscription.planVersionId,
    subscriptionSnapshotId: runtimeSnapshot.id,
    policyDecision,
    creditDecision,
    concurrencyDecision,
    ...(modelGate ? { modelGate } : {}),
    slotAcquired,
    ...(creditReservation ? { creditReservation } : {}),
  };
}

/** 执行后释放 agent-run 并发槽（与 authorizeCommercialRun acquire 配对）。 */
export async function releaseCommercialRunSlot(runId: string, storePath?: string): Promise<void> {
  const { releaseCreditReservation } = await import("./credit-reservation-store.js");
  await releaseCreditReservation({ runId }).catch(() => undefined);
  await finishAgentRun(runId, storePath);
}
