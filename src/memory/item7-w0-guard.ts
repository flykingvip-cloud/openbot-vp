/**
 * Item 7 W0: dual-read, dark tombstone, quarantine, delete-gate, and
 * rollback/revoke. Does not delete productionWriteWatchIndex call-sites.
 * Catalog miss=deny stays off. Item 7 stays not-met.
 */
export const ITEM7_W0_WAVE = "W0" as const;
export const ITEM7_W0_DARK_DUAL_READ_ENV = "OPENBOT_ITEM7_W0_DARK_DUAL_READ";
export const ITEM7_W0_CATALOG_MISS_DENY = false;
export const ITEM7_W0_DELETE_CALL_SITES = false;
export const ITEM7_W0_PRODUCTION_CATALOG_WRITE = false;
export const ITEM7_W0_SCHEMA_V2_WRITE = false;
export const ITEM7_W0_LIVE_WRITE_WATCH_INDEX = 37;
export const ITEM7_W0_FROZEN_WRITE_WATCH_INDEX = 38;
export const ITEM7_W0_RETIRED_THIS_CHANGE = 0;

export type Item7W0DualReadInput = {
  legacyLocator: string | null;
  replacementResourceId: string | null;
};

export type Item7W0DualReadResult = {
  wave: "W0";
  productionWrite: "legacy-only";
  comparison: "match" | "mismatch" | "replacement-missing" | "legacy-missing";
  quarantine: boolean;
  catalogMissDeny: false;
  deleteCallSites: false;
};

export type Item7W0TombstoneReceipt = {
  id: string;
  tenantId: string;
  resourceId: string;
  lifted: boolean;
  productionWrite: false;
  restoresLegacy: true;
};

export type Item7W0Denial = {
  allow: false;
  failClosed: true;
  reason:
    | "delete-call-sites-forbidden"
    | "retirement-forbidden"
    | "retirement-unlock-required"
    | "live-cutover-forbidden"
    | "catalog-miss-deny-forbidden"
    | "rewrite-watch-index-forbidden"
    | "item7-met-forbidden";
  retiredThisChange: 0;
  liveWriteWatchIndex: 37;
  retirementExecuted: false;
  item7Met: false;
};

function hasText(value: string | null): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function deny(reason: Item7W0Denial["reason"]): Item7W0Denial {
  return {
    allow: false,
    failClosed: true,
    reason,
    retiredThisChange: 0,
    liveWriteWatchIndex: ITEM7_W0_LIVE_WRITE_WATCH_INDEX,
    retirementExecuted: false,
    item7Met: false,
  };
}

export function isItem7W0DarkDualReadEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[ITEM7_W0_DARK_DUAL_READ_ENV];
  if (typeof raw !== "string") {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function compareItem7W0DualRead(input: Item7W0DualReadInput): Item7W0DualReadResult {
  const legacy = hasText(input.legacyLocator);
  const replacement = hasText(input.replacementResourceId);
  if (legacy && replacement) {
    const match = input.legacyLocator!.trim() === input.replacementResourceId!.trim();
    return {
      wave: "W0",
      productionWrite: "legacy-only",
      comparison: match ? "match" : "mismatch",
      quarantine: !match,
      catalogMissDeny: false,
      deleteCallSites: false,
    };
  }
  if (legacy && !replacement) {
    return {
      wave: "W0",
      productionWrite: "legacy-only",
      comparison: "replacement-missing",
      quarantine: true,
      catalogMissDeny: false,
      deleteCallSites: false,
    };
  }
  return {
    wave: "W0",
    productionWrite: "legacy-only",
    comparison: "legacy-missing",
    quarantine: true,
    catalogMissDeny: false,
    deleteCallSites: false,
  };
}

export function recordItem7W0Tombstone(input: {
  id: string;
  tenantId: string;
  resourceId: string;
}): Item7W0TombstoneReceipt {
  return {
    id: input.id.trim(),
    tenantId: input.tenantId.trim(),
    resourceId: input.resourceId.trim(),
    lifted: false,
    productionWrite: false,
    restoresLegacy: true,
  };
}

export function rollbackItem7W0Tombstone(
  receipt: Item7W0TombstoneReceipt,
): Item7W0TombstoneReceipt {
  return { ...receipt, lifted: true, restoresLegacy: true, productionWrite: false };
}

export function revokeItem7W0Tombstone(receipt: Item7W0TombstoneReceipt): Item7W0TombstoneReceipt {
  return rollbackItem7W0Tombstone(receipt);
}

export function evaluateItem7W0DeleteGate(input: {
  deleteCallSites?: boolean;
  liveWriteWatchIndex?: number;
}): Item7W0Denial {
  if (input.liveWriteWatchIndex === 0) {
    return deny("rewrite-watch-index-forbidden");
  }
  return deny("delete-call-sites-forbidden");
}

export function evaluateItem7W0Retirement(input: {
  retirementUnlockIssued?: boolean;
  executeRetirement?: boolean;
}): Item7W0Denial {
  if (input.executeRetirement === true && input.retirementUnlockIssued !== true) {
    return deny("retirement-unlock-required");
  }
  return deny("retirement-forbidden");
}

export function evaluateItem7W0LiveCutover(): Item7W0Denial {
  return deny("live-cutover-forbidden");
}

export function evaluateItem7W0CatalogMissDeny(
  enabled: boolean,
): Item7W0Denial | { allow: true; catalogMissDeny: false } {
  if (enabled) {
    return deny("catalog-miss-deny-forbidden");
  }
  return { allow: true, catalogMissDeny: false };
}

export function evaluateItem7W0Met(): Item7W0Denial {
  return deny("item7-met-forbidden");
}
