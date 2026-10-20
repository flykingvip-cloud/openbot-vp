/**
 * Item 7 W4: prove P5 steward helper dirs can be replaced by
 * resolveWorkspaceResource in shadow. Builtin/source/target helper
 * call-sites stay. Helper switch, deletion, miss=deny, and Item 7 met
 * stay forbidden.
 *
 * Does not call resolveEmployeeBuiltinStewardWorkspaceDir /
 * resolveEmployeeStewardSourceWorkspaceDir /
 * resolveEmployeeStewardTargetWorkspaceDir.
 */
import {
  decideItem7W1Write,
  evaluateItem7MetRequest,
  isItem7W1DarkDualReadEnabled,
  ITEM7_LIVE_WRITE_WATCH_INDEX,
  type Item7MetDecision,
} from "./item7-w1-dark-tombstone.js";

export const ITEM7_W4_WAVE = "W4" as const;
export const ITEM7_W4_CATALOG_MISS_DENY = false;
export const ITEM7_W4_DELETE_CALL_SITES = false;
export const ITEM7_W4_SITE_COUNT = 6;

export type Item7W4Symbol =
  | "resolveEmployeeBuiltinStewardWorkspaceDir"
  | "resolveEmployeeStewardSourceWorkspaceDir"
  | "resolveEmployeeStewardTargetWorkspaceDir";

export type Item7W4Site = {
  ledgerId: string;
  pathId: "P5";
  file: string;
  symbol: Item7W4Symbol;
  replacementSymbol: "resolveWorkspaceResource";
};

export const ITEM7_W4_SITES: readonly Item7W4Site[] = [
  {
    ledgerId: "S01",
    pathId: "P5",
    file: "src/auto-reply/reply/get-reply.ts",
    symbol: "resolveEmployeeBuiltinStewardWorkspaceDir",
    replacementSymbol: "resolveWorkspaceResource",
  },
  {
    ledgerId: "S06",
    pathId: "P5",
    file: "src/gateway/checkpoint-store.ts",
    symbol: "resolveEmployeeBuiltinStewardWorkspaceDir",
    replacementSymbol: "resolveWorkspaceResource",
  },
  {
    ledgerId: "S24",
    pathId: "P5",
    file: "src/gateway/workspace-resolver/steward-write.ts",
    symbol: "resolveEmployeeStewardSourceWorkspaceDir",
    replacementSymbol: "resolveWorkspaceResource",
  },
  {
    ledgerId: "S25",
    pathId: "P5",
    file: "src/gateway/workspace-resolver/steward-write.ts",
    symbol: "resolveEmployeeStewardTargetWorkspaceDir",
    replacementSymbol: "resolveWorkspaceResource",
  },
  {
    ledgerId: "S26",
    pathId: "P5",
    file: "src/gateway/workspace-resolver/steward-write.ts",
    symbol: "resolveEmployeeStewardSourceWorkspaceDir",
    replacementSymbol: "resolveWorkspaceResource",
  },
  {
    ledgerId: "S27",
    pathId: "P5",
    file: "src/gateway/workspace-resolver/steward-write.ts",
    symbol: "resolveEmployeeStewardTargetWorkspaceDir",
    replacementSymbol: "resolveWorkspaceResource",
  },
];

export type Item7W4HelperSwitchDecision = {
  allow: false;
  action: "keep-legacy-steward-helper";
  reason: "w4-shadow-steward-identity-only";
};

export type Item7W4StewardProof = {
  site: Item7W4Site;
  catalogIdentity: "hit" | "miss";
  quarantine: boolean;
  helperSwitch: Item7W4HelperSwitchDecision;
  productionWrite: "legacy-only";
  catalogMissDeny: false;
};

export function decideItem7W4HelperSwitch(): Item7W4HelperSwitchDecision {
  return {
    allow: false,
    action: "keep-legacy-steward-helper",
    reason: "w4-shadow-steward-identity-only",
  };
}

export function findItem7W4Site(ledgerId: string): Item7W4Site | null {
  return ITEM7_W4_SITES.find((site) => site.ledgerId === ledgerId) ?? null;
}

export function proveItem7W4StewardIdentity(params: {
  ledgerId: string;
  catalogResourceId: string | null;
}): Item7W4StewardProof | null {
  const site = findItem7W4Site(params.ledgerId);
  if (!site) {
    return null;
  }
  const hit =
    typeof params.catalogResourceId === "string" && params.catalogResourceId.trim().length > 0;
  return {
    site,
    catalogIdentity: hit ? "hit" : "miss",
    quarantine: !hit,
    helperSwitch: decideItem7W4HelperSwitch(),
    productionWrite: "legacy-only",
    catalogMissDeny: false,
  };
}

export function runItem7W4StewardHelperShadow(params: {
  ledgerId: string;
  catalogResourceId: string | null;
  env?: NodeJS.ProcessEnv;
}): Item7W4StewardProof | null {
  if (!isItem7W1DarkDualReadEnabled(params.env ?? process.env)) {
    return null;
  }
  return proveItem7W4StewardIdentity({
    ledgerId: params.ledgerId,
    catalogResourceId: params.catalogResourceId,
  });
}

export function scheduleItem7W4StewardHelperShadow(params: {
  ledgerId: string;
  catalogResourceId: string | null;
}): void {
  runItem7W4StewardHelperShadow(params);
}

export function evaluateItem7W4MetRequest(): Item7MetDecision {
  return evaluateItem7MetRequest({
    liveWriteWatchIndex: ITEM7_LIVE_WRITE_WATCH_INDEX,
    independentRetirementReviewAccepted: false,
    rollbackProof: false,
    quarantineProof: false,
  });
}

export function item7W4ReplacementWriteStillTombstoned(): boolean {
  const decision = decideItem7W1Write({ kind: "replacement-new" });
  return !decision.allow && decision.action === "tombstone-quarantine";
}
