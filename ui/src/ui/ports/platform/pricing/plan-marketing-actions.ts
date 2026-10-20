import type { Plan } from "../../../capability/cost-budget-billing/index.ts";
import type {
  PlatformPlanBundleGateway,
  PlanMatchingProfile,
} from "../../../capability/platform-plan-bundle/index.ts";

export type PlanMarketingTag = NonNullable<Plan["marketingTags"]>[number];

export function buildNextMarketingTags(
  current: readonly PlanMarketingTag[],
  tag: PlanMarketingTag,
  checked: boolean,
): PlanMarketingTag[] {
  return checked ? [...new Set([...current, tag])] : current.filter((entry) => entry !== tag);
}

function readFormString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export function buildMatchingProfileFromFormData(formData: FormData): PlanMatchingProfile {
  const targetPersonas = readFormString(formData, "targetPersonas")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const priorityRaw = readFormString(formData, "matchingPriority").trim();
  const matchingPriority = priorityRaw ? Number(priorityRaw) : undefined;
  const inPlanFlexibilityNotes = readFormString(formData, "inPlanFlexibilityNotes").trim();
  const beyondPlanNotes = readFormString(formData, "beyondPlanNotes").trim();

  return {
    ...(targetPersonas.length > 0 ? { targetPersonas } : {}),
    ...(matchingPriority != null && Number.isFinite(matchingPriority) ? { matchingPriority } : {}),
    ...(inPlanFlexibilityNotes ? { inPlanFlexibilityNotes } : {}),
    ...(beyondPlanNotes ? { beyondPlanNotes } : {}),
  };
}

export async function requestSetMarketingTags(params: {
  gateway: PlatformPlanBundleGateway;
  planId: string;
  marketingTags: PlanMarketingTag[];
}) {
  return params.gateway.setMarketingTags({
    planId: params.planId,
    marketingTags: params.marketingTags,
  });
}

export async function requestSetMatchingProfile(params: {
  gateway: PlatformPlanBundleGateway;
  planId: string;
  matchingProfile: PlanMatchingProfile;
}) {
  return params.gateway.setMatchingProfile({
    planId: params.planId,
    matchingProfile: params.matchingProfile,
  });
}
