import type { AllocationOverviewResponse } from "../../capability/cost-budget-billing/index.ts";
import type { SeatModelGrant } from "../../capability/model-authorization/types.ts";

export type SelectedOrgPosition = {
  orgSeatId: string;
  title: string;
  teamLabel: string;
};

export function parseAllocationSeatModelGrants(
  grants: AllocationOverviewResponse["grants"],
): SeatModelGrant[] {
  if (!Array.isArray(grants)) {
    return [];
  }
  return grants.filter(
    (entry): entry is SeatModelGrant =>
      typeof entry === "object" &&
      entry !== null &&
      "subjectType" in entry &&
      "subjectId" in entry &&
      "grantedModelIds" in entry,
  );
}

export function resolveEntitledModelIds(allocation: AllocationOverviewResponse): string[] {
  const ids = new Set<string>();
  for (const profile of allocation.roleProfiles) {
    for (const modelId of profile.modelIds) {
      const trimmed = modelId.trim();
      if (trimmed) {
        ids.add(trimmed);
      }
    }
  }
  for (const grant of parseAllocationSeatModelGrants(allocation.grants)) {
    for (const modelId of grant.grantedModelIds) {
      const trimmed = modelId.trim();
      if (trimmed) {
        ids.add(trimmed);
      }
    }
  }
  return [...ids].toSorted();
}

export function findOrgSeatModelGrant(
  grants: readonly SeatModelGrant[],
  orgSeatId: string,
): SeatModelGrant | null {
  const normalized = orgSeatId.trim();
  if (!normalized) {
    return null;
  }
  return (
    grants.find(
      (grant) =>
        grant.subjectType === "seat" &&
        grant.subjectId.trim() === normalized &&
        grant.status === "active",
    ) ?? null
  );
}

export function resolveSavedPositionModelIds(
  grants: readonly SeatModelGrant[],
  orgSeatId: string,
): string[] {
  const grant = findOrgSeatModelGrant(grants, orgSeatId);
  if (!grant) {
    return [];
  }
  return [...new Set(grant.grantedModelIds.map((id) => id.trim()).filter(Boolean))].toSorted();
}

export function positionModelBindingIsDirty(
  savedModelIds: readonly string[],
  draftModelIds: readonly string[],
): boolean {
  const saved = [...savedModelIds].toSorted().join("\0");
  const draft = [...draftModelIds].toSorted().join("\0");
  return saved !== draft;
}

export function togglePositionModelDraft(
  draft: ReadonlySet<string>,
  modelId: string,
  selected: boolean,
): Set<string> {
  const next = new Set(draft);
  const normalized = modelId.trim();
  if (!normalized) {
    return next;
  }
  if (selected) {
    next.add(normalized);
  } else {
    next.delete(normalized);
  }
  return next;
}
