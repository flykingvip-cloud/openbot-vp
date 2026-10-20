/**
 * 平台定价运营活动流（版本发布 / 订阅变更 / 升降级）。
 */

import { listPlans, listPlanVersions, listRecentPlanVersionStatusEvents } from "./plans-store.js";
import { listAllSubscriptionEvents } from "./subscriptions-store.js";
import type { PlanVersionStatusChangeEvent, SubscriptionEvent } from "./types.js";

export type PlatformPricingActivityKind =
  | "plan_version_published"
  | "plan_version_deprecated"
  | "subscription_started"
  | "subscription_ended"
  | "subscription_upgraded"
  | "subscription_downgraded";

export type PlatformPricingActivityItem = {
  id: string;
  kind: PlatformPricingActivityKind;
  occurredAt: string;
  planId?: string;
  planName?: string;
  fromPlanId?: string;
  fromPlanName?: string;
  versionNumber?: number;
  enterpriseId?: string;
};

function mapVersionStatusEvent(
  event: PlanVersionStatusChangeEvent,
  planNameById: Map<string, string>,
  versionNumberById: Map<string, number>,
): PlatformPricingActivityItem | null {
  if (event.fromStatus === "draft" && event.toStatus === "active") {
    return {
      id: event.id,
      kind: "plan_version_published",
      occurredAt: event.occurredAt,
      planId: event.planId,
      planName: planNameById.get(event.planId),
      versionNumber: versionNumberById.get(event.versionId),
    };
  }
  if (event.fromStatus === "active" && event.toStatus === "deprecated") {
    return {
      id: event.id,
      kind: "plan_version_deprecated",
      occurredAt: event.occurredAt,
      planId: event.planId,
      planName: planNameById.get(event.planId),
      versionNumber: versionNumberById.get(event.versionId),
    };
  }
  return null;
}

function mapSubscriptionEvent(
  event: SubscriptionEvent,
  planIdByVersionId: Map<string, string>,
  planNameById: Map<string, string>,
  suppressedEventIds: Set<string>,
): PlatformPricingActivityItem | null {
  if (suppressedEventIds.has(event.id)) {
    return null;
  }
  const planId = planIdByVersionId.get(event.planVersionId);
  if (event.fromStatus === null && event.toStatus === "active") {
    return {
      id: event.id,
      kind: "subscription_started",
      occurredAt: event.occurredAt,
      planId,
      planName: planId ? planNameById.get(planId) : undefined,
      enterpriseId: event.enterpriseId,
    };
  }
  if (
    event.fromStatus === "active" &&
    (event.toStatus === "canceled" || event.toStatus === "expired")
  ) {
    return {
      id: event.id,
      kind: "subscription_ended",
      occurredAt: event.occurredAt,
      planId,
      planName: planId ? planNameById.get(planId) : undefined,
      enterpriseId: event.enterpriseId,
    };
  }
  return null;
}

function detectPlanChangeActivities(params: {
  subscriptionEvents: SubscriptionEvent[];
  planIdByVersionId: Map<string, string>;
  planNameById: Map<string, string>;
  planPriceById: Map<string, number>;
}): { items: PlatformPricingActivityItem[]; suppressedEventIds: Set<string> } {
  const byEnterprise = new Map<string, SubscriptionEvent[]>();
  for (const event of params.subscriptionEvents) {
    const list = byEnterprise.get(event.enterpriseId) ?? [];
    list.push(event);
    byEnterprise.set(event.enterpriseId, list);
  }

  const items: PlatformPricingActivityItem[] = [];
  const suppressedEventIds = new Set<string>();

  for (const [enterpriseId, enterpriseEvents] of byEnterprise) {
    const sorted = enterpriseEvents.toSorted((left, right) =>
      left.occurredAt.localeCompare(right.occurredAt),
    );
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const ended = sorted[index];
      const started = sorted[index + 1];
      if (!ended || !started) {
        continue;
      }
      const endedActive =
        ended.fromStatus === "active" &&
        (ended.toStatus === "canceled" || ended.toStatus === "expired");
      const startedActive = started.fromStatus === null && started.toStatus === "active";
      if (!endedActive || !startedActive) {
        continue;
      }
      const fromPlanId = params.planIdByVersionId.get(ended.planVersionId);
      const toPlanId = params.planIdByVersionId.get(started.planVersionId);
      if (!fromPlanId || !toPlanId || fromPlanId === toPlanId) {
        continue;
      }
      const fromPrice = params.planPriceById.get(fromPlanId) ?? 0;
      const toPrice = params.planPriceById.get(toPlanId) ?? 0;
      const kind: PlatformPricingActivityKind =
        toPrice >= fromPrice ? "subscription_upgraded" : "subscription_downgraded";
      items.push({
        id: `plan-change-${ended.id}-${started.id}`,
        kind,
        occurredAt: started.occurredAt,
        planId: toPlanId,
        planName: params.planNameById.get(toPlanId),
        fromPlanId,
        fromPlanName: params.planNameById.get(fromPlanId),
        enterpriseId,
      });
      suppressedEventIds.add(ended.id);
      suppressedEventIds.add(started.id);
      index += 1;
    }
  }

  return { items, suppressedEventIds };
}

export async function buildPlatformPricingActivityFeed(params?: {
  limit?: number;
  storePath?: string;
}): Promise<PlatformPricingActivityItem[]> {
  const limit = params?.limit ?? 20;
  const [plans, versionEvents, subscriptionEvents] = await Promise.all([
    listPlans(params?.storePath),
    listRecentPlanVersionStatusEvents(Math.max(limit, 40), params?.storePath),
    listAllSubscriptionEvents(params?.storePath),
  ]);
  const planNameById = new Map(plans.map((plan) => [plan.id, plan.name]));
  const planPriceById = new Map(plans.map((plan) => [plan.id, plan.basePriceCents]));
  const planIdByVersionId = new Map<string, string>();
  const versionNumberById = new Map<string, number>();
  await Promise.all(
    plans.map(async (plan) => {
      const versions = await listPlanVersions(plan.id, params?.storePath);
      for (const version of versions) {
        planIdByVersionId.set(version.id, plan.id);
        versionNumberById.set(version.id, version.version);
      }
    }),
  );

  const { items: planChangeItems, suppressedEventIds } = detectPlanChangeActivities({
    subscriptionEvents,
    planIdByVersionId,
    planNameById,
    planPriceById,
  });

  const items: PlatformPricingActivityItem[] = [...planChangeItems];
  for (const event of versionEvents) {
    const mapped = mapVersionStatusEvent(event, planNameById, versionNumberById);
    if (mapped) {
      items.push(mapped);
    }
  }
  for (const event of subscriptionEvents) {
    const mapped = mapSubscriptionEvent(event, planIdByVersionId, planNameById, suppressedEventIds);
    if (mapped) {
      items.push(mapped);
    }
  }

  return items
    .toSorted((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, limit);
}
