/**
 * 解析 subscriptions.get 下发的 entitlementSnapshot。
 */

import type { PlanCapacityEntitlement } from "./plan-capacity-display.ts";

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.filter((item): item is string => typeof item === "string");
  return items.length > 0 ? items : undefined;
}

export function parseSubscriptionEntitlement(raw: unknown): PlanCapacityEntitlement | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const snap = raw as Record<string, unknown>;
  const featuresRaw = snap.features;
  const features =
    featuresRaw && typeof featuresRaw === "object"
      ? {
          auditLog: (featuresRaw as Record<string, unknown>).auditLog === true,
          mfa: (featuresRaw as Record<string, unknown>).mfa === true,
          sso: (featuresRaw as Record<string, unknown>).sso === true,
          vpcIsolation: (featuresRaw as Record<string, unknown>).vpcIsolation === true,
        }
      : undefined;

  const entitlement: PlanCapacityEntitlement = {
    monthlyCredits: readNumber(snap.monthlyCredits),
    maxConcurrentRuns: readNumber(snap.maxConcurrentRuns),
    maxWorkflows: readNumber(snap.maxWorkflows),
    maxKnowledgeBases: readNumber(snap.maxKnowledgeBases),
    allowedTiers: readStringArray(snap.allowedTiers),
    allowedPolicies: readStringArray(snap.allowedPolicies),
    features,
  };

  const hasData =
    entitlement.monthlyCredits !== undefined ||
    entitlement.maxConcurrentRuns !== undefined ||
    entitlement.maxWorkflows !== undefined ||
    entitlement.maxKnowledgeBases !== undefined ||
    (entitlement.allowedTiers?.length ?? 0) > 0 ||
    (entitlement.allowedPolicies?.length ?? 0) > 0 ||
    features?.auditLog ||
    features?.mfa ||
    features?.sso ||
    features?.vpcIsolation;

  return hasData ? entitlement : null;
}
