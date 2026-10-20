/**
 * 按订阅权益解析企业计费模式（IO 层）。
 */

import { getActiveSubscription } from "../billing/subscriptions-store.js";
import {
  resolveBillingModeFromMonthlyCredits,
  type EnterpriseBillingMode,
} from "./billing-mode.js";
import { getPlanEntitlementSnapshot } from "./plan-version-entitlement-store.js";

export type BillingModeStorePaths = {
  subscriptions?: string;
  entitlementSnapshot?: string;
};

export async function resolveEnterpriseBillingMode(
  enterpriseId: string,
  storePaths?: BillingModeStorePaths,
): Promise<EnterpriseBillingMode> {
  const subscription = await getActiveSubscription(enterpriseId, storePaths?.subscriptions);
  if (!subscription) {
    return "credits";
  }
  const entitlement = await getPlanEntitlementSnapshot(
    subscription.planVersionId,
    storePaths?.entitlementSnapshot,
  );
  return resolveBillingModeFromMonthlyCredits(entitlement?.monthlyCredits ?? 0);
}
