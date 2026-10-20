/**
 * 活跃订阅 → 企业套餐索引（供 Economics 按套餐过滤企业）。
 */

import { listPlans } from "../billing/plans-store.js";
import { listActiveSubscriptions } from "../billing/subscriptions-store.js";

export type EnterprisePlanRef = {
  planId: string;
  planName: string;
};

export async function buildEnterprisePlanIndex(
  storePath?: string,
): Promise<Record<string, EnterprisePlanRef>> {
  const [plans, subscriptions] = await Promise.all([
    listPlans(),
    listActiveSubscriptions(storePath),
  ]);
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const out: Record<string, EnterprisePlanRef> = {};
  for (const sub of subscriptions) {
    const plan = planById.get(sub.planId);
    if (!plan) {
      continue;
    }
    out[sub.enterpriseId] = {
      planId: plan.id,
      planName: plan.name,
    };
  }
  return out;
}
