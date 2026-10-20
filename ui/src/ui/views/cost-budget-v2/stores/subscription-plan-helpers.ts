import type { Plan } from "../../../capability/cost-budget-billing/index.ts";
import { getSubscriptionStoreState } from "./subscription-store.ts";

export function resolveSubscriptionPlan(planId: string | null): Plan | null {
  if (!planId) {
    return null;
  }
  const subscription = getSubscriptionStoreState().data;
  return subscription?.availablePlans.find((plan) => plan.id === planId) ?? null;
}

export function resolveCurrentSubscriptionPlan(): Plan | null {
  const subscription = getSubscriptionStoreState().data;
  if (!subscription?.subscription) {
    return null;
  }
  return (
    subscription.planView ??
    subscription.availablePlans.find((plan) => plan.id === subscription.subscription?.planId) ??
    null
  );
}

export function resolvePlanEntitlement(planId: string): unknown {
  const subscription = getSubscriptionStoreState().data;
  return subscription?.planEntitlements?.[planId] ?? subscription?.entitlementSnapshot;
}
