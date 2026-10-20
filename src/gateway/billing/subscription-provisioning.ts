/**
 * 订阅后企业开通编排：entitlement 投影 → Credits 初始化 → 席位 grant 同步。
 *
 * 平台端定义套餐 → 企业订阅 → 本模块串联后续投影与分配，避免「订了套餐但 entitlement/grant 未就绪」。
 */

import { loadConfig } from "../../config/config.js";
import { applyRoleGrantProfileForSeat } from "../model-entitlement/apply-role-grant-profile.js";
import { resolveModelEntitlementRoutingMode } from "../model-entitlement/entitlement-config.js";
import { refreshEnterpriseModelEntitlement } from "../model-entitlement/entitlement-projection.js";
import type { EnterpriseModelEntitlement } from "../model-entitlement/types.js";
import { getPlanEntitlementSnapshot } from "../package-entitlement/plan-version-entitlement-store.js";
import { resolveCreditsResetCycle } from "./billing-period.js";
import { bootstrapBillingSeatsFromOrganization } from "./bootstrap-seat-allocation.js";
import type { SeatBootstrapResult } from "./bootstrap-seat-allocation.js";
import { refreshOverAllocationState } from "./compute-over-allocation.js";
import { ensurePlanCycleCreditBucket } from "./credit-buckets-store.js";
import { resolveCycleWindow } from "./runtime.js";
import { listSeats } from "./seats-store.js";
import { materializeSubscriptionRuntimeSnapshot } from "./subscription-transition-engine.js";
import { getActiveSubscription } from "./subscriptions-store.js";
import { ensureTenantCreditsAllocation } from "./tenant-credits-store.js";
import type { Subscription } from "./types.js";

export type ProvisionEnterpriseSubscriptionInput = {
  enterpriseId: string;
  planVersionId: string;
  /** 调用方已绑定 commercialContract 时传入，确保 snapshot billingCycle 正确。 */
  subscription?: Subscription;
  actorUserId?: string;
  /** 为 true 时为所有已分配席位重应用角色模型档案（订阅/换套餐后默认开启）。 */
  syncSeatGrants?: boolean;
};

export type ProvisionEnterpriseSubscriptionResult = {
  entitlement: EnterpriseModelEntitlement | null;
  creditsInitialized: boolean;
  monthlyCredits: number;
  seatGrantsSynced: { applied: number; skipped: number };
  /** 按组织/成员目录自动分配计费席位并应用角色模型档案。 */
  seatBootstrap: SeatBootstrapResult;
  runtimeSnapshotId?: string;
};

/**
 * 企业订阅生效后的确定性开通步骤（同步执行，幂等）。
 */
export async function provisionEnterpriseSubscription(
  input: ProvisionEnterpriseSubscriptionInput,
): Promise<ProvisionEnterpriseSubscriptionResult> {
  const cfg = loadConfig();
  const routingMode = resolveModelEntitlementRoutingMode(cfg);

  const entitlement = await refreshEnterpriseModelEntitlement(input.enterpriseId, {
    routingMode,
  });

  const snapshot = await getPlanEntitlementSnapshot(input.planVersionId);
  const monthlyCredits = snapshot?.monthlyCredits ?? 0;
  let creditsInitialized = false;

  const subscription = input.subscription ?? (await getActiveSubscription(input.enterpriseId));
  // Credits 桶按 **额度重置周期**（monthly）分配，不是年付/季付合同窗。
  // 合同已结束后不得创建新额度桶（resolveCreditsResetCycle → ContractEndedError）。
  let cycleStart: string | null = null;
  if (subscription) {
    try {
      cycleStart = resolveCreditsResetCycle(subscription, new Date()).cycleStart;
    } catch (err) {
      // 合同已结束 / 无效边界：跳过 Credits 初始化，禁止自然月退化开桶
      if (
        err instanceof Error &&
        (err.name === "ContractEndedError" || err.name === "InvalidContractError")
      ) {
        cycleStart = null;
      } else {
        throw err;
      }
    }
  } else {
    cycleStart = resolveCycleWindow().cycleStart;
  }

  if (monthlyCredits > 0 && cycleStart) {
    await ensureTenantCreditsAllocation({
      enterpriseId: input.enterpriseId,
      cycleStart,
      monthlyCredits,
    });
    await ensurePlanCycleCreditBucket({
      enterpriseId: input.enterpriseId,
      cycleStart,
      monthlyCredits,
    });
    creditsInitialized = true;
  }

  let runtimeSnapshotId: string | undefined;
  if (subscription) {
    const runtimeSnapshot = await materializeSubscriptionRuntimeSnapshot({
      enterpriseId: input.enterpriseId,
      subscription,
    });
    runtimeSnapshotId = runtimeSnapshot.id;
    if (monthlyCredits > 0 && cycleStart) {
      await ensurePlanCycleCreditBucket({
        enterpriseId: input.enterpriseId,
        cycleStart,
        monthlyCredits,
        subscriptionSnapshotId: runtimeSnapshot.id,
      });
    }
    await refreshOverAllocationState({
      enterpriseId: input.enterpriseId,
      snapshot: runtimeSnapshot,
    });
  }

  const seatBootstrap = await bootstrapBillingSeatsFromOrganization({
    enterpriseId: input.enterpriseId,
    planVersionId: input.planVersionId,
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
  });

  const seatGrantsSynced = { applied: 0, skipped: 0 };
  if (input.syncSeatGrants !== false && entitlement) {
    const seats = await listSeats(input.enterpriseId);
    for (const seat of seats) {
      const result = await applyRoleGrantProfileForSeat({
        tenantId: input.enterpriseId,
        seatId: seat.id,
        role: seat.currentRole,
        ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
      });
      if (result.applied) {
        seatGrantsSynced.applied += 1;
      } else {
        seatGrantsSynced.skipped += 1;
      }
    }
  }

  return {
    entitlement,
    creditsInitialized,
    monthlyCredits,
    seatGrantsSynced,
    seatBootstrap,
    ...(runtimeSnapshotId ? { runtimeSnapshotId } : {}),
  };
}
