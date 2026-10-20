/**
 * 平台租户 billingStatus 投影：Subscription + Commercial 状态 → platform-auth enterprise。
 *
 * 设计见 `.kiro/specs/subscription-commerce/design.md` §平台 billingStatus 投影。
 */

import { loadConfig } from "../../config/config.js";
import { getPlan, getPlanVersion } from "../billing/plans-store.js";
import {
  getActiveSubscription,
  getPendingPaymentSubscription,
} from "../billing/subscriptions-store.js";
import { resolvePlatformAuthConfig } from "../platform-auth.js";
import type { PlatformAuthEnterprise, PlatformAuthStore } from "../platform-auth/store-types.js";
import {
  loadPlatformAuthStore,
  savePlatformAuthStore,
  withPlatformAuthStoreWriteLock,
} from "../platform-auth/store.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import { listCommercialOrders } from "./commercial-orders-store.js";
import { isTrialPlan } from "./plan-commercial-policy.js";

export type TenantBillingProjectionStatus =
  | "none"
  | "trialing"
  | "active"
  | "past_due"
  | "suspended";

function findEnterprise(
  store: PlatformAuthStore,
  enterpriseId: string,
): PlatformAuthEnterprise | null {
  const target = canonicalizeTenantId(enterpriseId) ?? enterpriseId;
  for (const [key, enterprise] of Object.entries(store.enterprises)) {
    const canon = canonicalizeTenantId(key) ?? key;
    if (canon === target || enterprise.slug === target || enterprise.id === target) {
      return enterprise;
    }
  }
  return null;
}

/** 纯推导：不写入 platform-auth。 */
export async function resolveTenantBillingProjectionStatus(
  enterpriseId: string,
): Promise<TenantBillingProjectionStatus> {
  const pendingOrders = await listCommercialOrders(enterpriseId, {
    status: "pending_payment",
    limit: 1,
  });
  if (pendingOrders.length > 0) {
    return "past_due";
  }

  const pendingSub = await getPendingPaymentSubscription(enterpriseId);
  if (pendingSub) {
    return "past_due";
  }

  const active = await getActiveSubscription(enterpriseId);
  if (!active) {
    return "none";
  }

  if (active.status === "suspended") {
    return "suspended";
  }
  if (active.status === "pending_payment") {
    return "past_due";
  }

  if (active.status === "active") {
    const plan = await getPlan(active.planId);
    const version = await getPlanVersion(active.planVersionId);
    if (plan && isTrialPlan(plan, version)) {
      return "trialing";
    }
    return "active";
  }

  return "none";
}

export type SyncTenantBillingProjectionResult = {
  enterpriseId: string;
  status: TenantBillingProjectionStatus;
  updated: boolean;
  previousStatus?: string;
};

/**
 * 将推导结果写入 platform-auth enterprise.billingStatus（企业存在时）。
 * 平台鉴权未启用或无对应 enterprise 时 no-op。
 */
export async function syncTenantBillingProjection(
  enterpriseId: string,
): Promise<SyncTenantBillingProjectionResult> {
  const status = await resolveTenantBillingProjectionStatus(enterpriseId);
  const cfg = loadConfig();
  const authConfig = resolvePlatformAuthConfig(cfg.gateway?.auth?.trustedProxy);
  if (!authConfig?.enabled) {
    return { enterpriseId, status, updated: false };
  }

  let updated = false;
  let previousStatus: string | undefined;

  await withPlatformAuthStoreWriteLock(authConfig, async () => {
    const store = await loadPlatformAuthStore(authConfig);
    const enterprise = findEnterprise(store, enterpriseId);
    if (!enterprise) {
      return;
    }
    previousStatus = enterprise.billingStatus;
    if (enterprise.billingStatus === status) {
      return;
    }
    enterprise.billingStatus = status;
    enterprise.updatedAt = new Date().toISOString();
    if (status === "active" && enterprise.status === "trial") {
      enterprise.status = "paid";
    }
    await savePlatformAuthStore(authConfig, store);
    updated = true;
  });

  return { enterpriseId, status, updated, ...(previousStatus ? { previousStatus } : {}) };
}
