/**
 * Item 7 W1: dark dual-read and tombstone/quarantine for replacement-path
 * new writes. Catalog miss=deny stays off. Legacy productionWriteWatchIndex
 * call-sites are not deleted. Item 7 stays not-met until remaining=0 and
 * independent Retirement review lands.
 *
 * Does not call resolveAgentWorkspaceDir / createEmptyWorkspaceCatalog /
 * syncMemoryFiles. Callers pass already-resolved locators so Freeze counts
 * stay unchanged.
 */
export const ITEM7_W1_WAVE = "W1" as const;
export const ITEM7_W1_DARK_DUAL_READ_ENV = "OPENBOT_ITEM7_W1_DARK_DUAL_READ";
export const ITEM7_W1_CATALOG_MISS_DENY = false;
export const ITEM7_W1_DELETE_CALL_SITES = false;
export const ITEM7_W1_PRODUCTION_CATALOG_WRITE = false;
export const ITEM7_W1_SCHEMA_V2_WRITE = false;
export const ITEM7_LIVE_WRITE_WATCH_INDEX = 37;
export const ITEM7_FROZEN_WRITE_WATCH_INDEX = 38;

export type Item7W1WriteKind = "legacy-production" | "replacement-new";

export type Item7W1DualReadInput = {
  legacyLocator: string | null;
  replacementResourceId: string | null;
};

export type Item7W1DualReadResult = {
  productionWrite: "legacy-only";
  comparison: "match" | "mismatch" | "replacement-missing" | "legacy-missing";
  quarantine: boolean;
  catalogMissDeny: false;
};

export type Item7W1WriteAttempt = {
  kind: Item7W1WriteKind;
  liveWriteWatchIndex?: number;
};

export type Item7W1WriteDecision =
  | { allow: true; action: "keep-legacy-production"; reason: "w1-does-not-intercept-legacy-sites" }
  | {
      allow: false;
      action: "tombstone-quarantine";
      reason: "w1-dark-tombstone-replacement-new-write";
    };

export type Item7MetRequest = {
  liveWriteWatchIndex: number;
  independentRetirementReviewAccepted: boolean;
  rollbackProof: boolean;
  quarantineProof: boolean;
  deleteCallSites?: boolean;
};

export type Item7MetDecision = {
  allow: false;
  reason:
    | "live-write-watch-index-nonzero"
    | "independent-retirement-review-required"
    | "rollback-proof-required"
    | "quarantine-proof-required"
    | "delete-call-sites-forbidden"
    | "w1-does-not-score-item7-met";
  item7: "not-met";
  failClosed: true;
};

function hasText(value: string | null): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function isItem7W1DarkDualReadEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[ITEM7_W1_DARK_DUAL_READ_ENV];
  if (typeof raw !== "string") {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function compareItem7W1DualRead(input: Item7W1DualReadInput): Item7W1DualReadResult {
  const legacy = hasText(input.legacyLocator);
  const replacement = hasText(input.replacementResourceId);
  if (legacy && replacement) {
    const match = input.legacyLocator!.trim() === input.replacementResourceId!.trim();
    return {
      productionWrite: "legacy-only",
      comparison: match ? "match" : "mismatch",
      quarantine: !match,
      catalogMissDeny: false,
    };
  }
  if (legacy && !replacement) {
    return {
      productionWrite: "legacy-only",
      comparison: "replacement-missing",
      quarantine: true,
      catalogMissDeny: false,
    };
  }
  return {
    productionWrite: "legacy-only",
    comparison: "legacy-missing",
    quarantine: true,
    catalogMissDeny: false,
  };
}

export function decideItem7W1Write(attempt: Item7W1WriteAttempt): Item7W1WriteDecision {
  if (attempt.kind === "legacy-production") {
    return {
      allow: true,
      action: "keep-legacy-production",
      reason: "w1-does-not-intercept-legacy-sites",
    };
  }
  return {
    allow: false,
    action: "tombstone-quarantine",
    reason: "w1-dark-tombstone-replacement-new-write",
  };
}

export function evaluateItem7MetRequest(request: Item7MetRequest): Item7MetDecision {
  if (request.deleteCallSites === true) {
    return {
      allow: false,
      reason: "delete-call-sites-forbidden",
      item7: "not-met",
      failClosed: true,
    };
  }
  if (request.liveWriteWatchIndex !== 0) {
    return {
      allow: false,
      reason: "live-write-watch-index-nonzero",
      item7: "not-met",
      failClosed: true,
    };
  }
  if (!request.independentRetirementReviewAccepted) {
    return {
      allow: false,
      reason: "independent-retirement-review-required",
      item7: "not-met",
      failClosed: true,
    };
  }
  if (!request.rollbackProof) {
    return {
      allow: false,
      reason: "rollback-proof-required",
      item7: "not-met",
      failClosed: true,
    };
  }
  if (!request.quarantineProof) {
    return {
      allow: false,
      reason: "quarantine-proof-required",
      item7: "not-met",
      failClosed: true,
    };
  }
  return {
    allow: false,
    reason: "w1-does-not-score-item7-met",
    item7: "not-met",
    failClosed: true,
  };
}
