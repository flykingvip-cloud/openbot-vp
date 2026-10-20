/**
 * 在席位 / Bot 等资源变更后刷新 OverAllocationState（P1）。
 */

import { refreshOverAllocationState } from "./compute-over-allocation.js";
import { getActiveSubscriptionRuntimeSnapshot } from "./subscription-runtime-snapshots-store.js";
import { materializeSubscriptionRuntimeSnapshot } from "./subscription-transition-engine.js";
import { getActiveSubscription } from "./subscriptions-store.js";
import type { OverAllocationState } from "./types.js";

export type RefreshEnterpriseOverAllocationStorePaths = {
  subscriptions?: string;
  runtimeSnapshots?: string;
  plans?: string;
  entitlementSnapshot?: string;
  modelBinding?: string;
  seats?: string;
  bots?: string;
  seatEntitlementAssignments?: string;
  overAllocation?: string;
};

/** 有生效订阅时重算超配；无订阅则 no-op。 */
export async function refreshEnterpriseOverAllocationIfSubscribed(
  enterpriseId: string,
  storePaths?: RefreshEnterpriseOverAllocationStorePaths,
): Promise<OverAllocationState | null> {
  const subscription = await getActiveSubscription(enterpriseId, storePaths?.subscriptions);
  if (!subscription) {
    return null;
  }
  let snapshot = await getActiveSubscriptionRuntimeSnapshot(
    enterpriseId,
    storePaths?.runtimeSnapshots,
  );
  if (!snapshot) {
    snapshot = await materializeSubscriptionRuntimeSnapshot({
      enterpriseId,
      subscription,
      storePaths: {
        plans: storePaths?.plans,
        entitlementSnapshot: storePaths?.entitlementSnapshot,
        modelBinding: storePaths?.modelBinding,
        runtimeSnapshots: storePaths?.runtimeSnapshots,
      },
    });
  }
  try {
    return await refreshOverAllocationState({
      enterpriseId,
      snapshot,
      storePaths: {
        seats: storePaths?.seats,
        bots: storePaths?.bots,
        seatEntitlementAssignments: storePaths?.seatEntitlementAssignments,
        overAllocation: storePaths?.overAllocation,
      },
    });
  } catch {
    return null;
  }
}
