/**
 * Credits 双向对账：CreditBucket 聚合 vs Usage Ledger vs tenant-credits 兼容层（P1）。
 */

import { sumLedgerCreditsByPricingEngine } from "../economics/aggregate-by-pricing-engine.js";
import type { TenantCreditsBalance } from "../package-entitlement/types.js";
import {
  listCreditBucketsForCycle,
  syncPlanCycleBucketFromLegacyBalance,
} from "./credit-buckets-store.js";
import { resolveEnterpriseCreditsResetWindow } from "./runtime.js";
import { getTenantCreditsBalance } from "./tenant-credits-store.js";
import { listUsageLedgerEntries } from "./usage-ledger-store.js";

export type BillingReconciliationResult = {
  enterpriseId: string;
  cycleStart: string;
  cycleEnd: string;
  bucketGranted: number;
  bucketConsumed: number;
  bucketRemaining: number;
  ledgerCreditsCharged: number;
  /** 账本 v1 计价引擎 Credits 合计（缺省 pricingEngine 视为 v1）。 */
  ledgerCreditsV1: number;
  /** 账本 v2 计价引擎 Credits 合计。 */
  ledgerCreditsV2: number;
  legacyBalance: TenantCreditsBalance | null;
  aligned: boolean;
  driftCredits: number;
  details: string[];
};

export async function reconcileEnterpriseCredits(
  enterpriseId: string,
  opts?: {
    now?: Date;
    storePaths?: {
      creditBuckets?: string;
      tenantCredits?: string;
      usageLedger?: string;
      subscriptions?: string;
      plans?: string;
    };
  },
): Promise<BillingReconciliationResult> {
  const now = opts?.now ?? new Date();
  // 对账对齐 Credits 重置桶（monthly），不是年付合同窗
  const { cycleStart, cycleEnd } = await resolveEnterpriseCreditsResetWindow(enterpriseId, now, {
    subscriptions: opts?.storePaths?.subscriptions,
  });
  await syncPlanCycleBucketFromLegacyBalance(
    { enterpriseId, cycleStart },
    {
      creditBuckets: opts?.storePaths?.creditBuckets,
      tenantCredits: opts?.storePaths?.tenantCredits,
    },
  );
  const buckets = await listCreditBucketsForCycle(
    enterpriseId,
    cycleStart,
    opts?.storePaths?.creditBuckets,
  );
  const bucketGranted = buckets.reduce((sum, b) => sum + b.creditsGranted, 0);
  const bucketConsumed = buckets.reduce((sum, b) => sum + b.creditsConsumed, 0);
  const bucketRemaining = Math.max(0, bucketGranted - bucketConsumed);

  const ledgerEntries = await listUsageLedgerEntries(
    enterpriseId,
    { startTime: cycleStart, endTime: cycleEnd },
    opts?.storePaths?.usageLedger,
  );
  const { ledgerCreditsV1, ledgerCreditsV2 } = sumLedgerCreditsByPricingEngine(ledgerEntries);
  const ledgerCreditsCharged = ledgerCreditsV1 + ledgerCreditsV2;

  const legacyBalance = await getTenantCreditsBalance(
    enterpriseId,
    cycleStart,
    opts?.storePaths?.tenantCredits,
  );

  const details: string[] = [];
  let aligned = true;

  if (legacyBalance) {
    if (legacyBalance.monthlyCredits !== bucketGranted) {
      aligned = false;
      details.push(
        `legacy monthlyCredits (${legacyBalance.monthlyCredits}) != bucket granted (${bucketGranted})`,
      );
    }
    if (legacyBalance.creditsConsumed !== bucketConsumed) {
      aligned = false;
      details.push(
        `legacy consumed (${legacyBalance.creditsConsumed}) != bucket consumed (${bucketConsumed})`,
      );
    }
  }

  if (bucketConsumed !== ledgerCreditsCharged) {
    aligned = false;
    details.push(`bucket consumed (${bucketConsumed}) != ledger charged (${ledgerCreditsCharged})`);
  }

  const driftCredits = bucketConsumed - ledgerCreditsCharged;

  return {
    enterpriseId,
    cycleStart,
    cycleEnd,
    bucketGranted,
    bucketConsumed,
    bucketRemaining,
    ledgerCreditsCharged,
    ledgerCreditsV1,
    ledgerCreditsV2,
    legacyBalance,
    aligned,
    driftCredits,
    details,
  };
}
