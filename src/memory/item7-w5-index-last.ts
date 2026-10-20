/**
 * Item 7 W5: prove memory index/dir sites can be replaced by
 * resolveMemoryWorkspaceHandle in shadow. Index and workspace-dir
 * call-sites stay so rollback can still locate. Index switch, deletion,
 * miss=deny, and Item 7 met stay forbidden.
 *
 * Does not call resolveAgentWorkspaceDir / syncMemoryFiles.
 */
import {
  decideItem7W1Write,
  evaluateItem7MetRequest,
  isItem7W1DarkDualReadEnabled,
  ITEM7_LIVE_WRITE_WATCH_INDEX,
  type Item7MetDecision,
} from "./item7-w1-dark-tombstone.js";

export const ITEM7_W5_WAVE = "W5" as const;
export const ITEM7_W5_CATALOG_MISS_DENY = false;
export const ITEM7_W5_DELETE_CALL_SITES = false;
export const ITEM7_W5_SITE_COUNT = 8;

export type Item7W5PathId = "P1" | "P8";

export type Item7W5Symbol = "resolveAgentWorkspaceDir" | "syncMemoryFiles";

export type Item7W5Site = {
  ledgerId: string;
  pathId: Item7W5PathId;
  file: string;
  symbol: Item7W5Symbol;
  replacementSymbol: "resolveMemoryWorkspaceHandle";
};

export const ITEM7_W5_SITES: readonly Item7W5Site[] = [
  {
    ledgerId: "S30",
    pathId: "P1",
    file: "src/memory/backend-config.ts",
    symbol: "resolveAgentWorkspaceDir",
    replacementSymbol: "resolveMemoryWorkspaceHandle",
  },
  {
    ledgerId: "S31",
    pathId: "P1",
    file: "src/memory/backend-config.ts",
    symbol: "resolveAgentWorkspaceDir",
    replacementSymbol: "resolveMemoryWorkspaceHandle",
  },
  {
    ledgerId: "S32",
    pathId: "P1",
    file: "src/memory/cogniweave-manager.ts",
    symbol: "resolveAgentWorkspaceDir",
    replacementSymbol: "resolveMemoryWorkspaceHandle",
  },
  {
    ledgerId: "S33",
    pathId: "P8",
    file: "src/memory/manager-sync-ops.ts",
    symbol: "syncMemoryFiles",
    replacementSymbol: "resolveMemoryWorkspaceHandle",
  },
  {
    ledgerId: "S34",
    pathId: "P8",
    file: "src/memory/manager-sync-ops.ts",
    symbol: "syncMemoryFiles",
    replacementSymbol: "resolveMemoryWorkspaceHandle",
  },
  {
    ledgerId: "S35",
    pathId: "P8",
    file: "src/memory/manager-sync-ops.ts",
    symbol: "syncMemoryFiles",
    replacementSymbol: "resolveMemoryWorkspaceHandle",
  },
  {
    ledgerId: "S36",
    pathId: "P1",
    file: "src/memory/manager.ts",
    symbol: "resolveAgentWorkspaceDir",
    replacementSymbol: "resolveMemoryWorkspaceHandle",
  },
  {
    ledgerId: "S37",
    pathId: "P1",
    file: "src/memory/qmd-manager.ts",
    symbol: "resolveAgentWorkspaceDir",
    replacementSymbol: "resolveMemoryWorkspaceHandle",
  },
];

export type Item7W5IndexSwitchDecision = {
  allow: false;
  action: "keep-legacy-index";
  reason: "w5-shadow-handle-identity-only";
};

export type Item7W5IndexProof = {
  site: Item7W5Site;
  handleIdentity: "hit" | "miss";
  quarantine: boolean;
  indexSwitch: Item7W5IndexSwitchDecision;
  productionWrite: "legacy-only";
  catalogMissDeny: false;
};

export function decideItem7W5IndexSwitch(): Item7W5IndexSwitchDecision {
  return {
    allow: false,
    action: "keep-legacy-index",
    reason: "w5-shadow-handle-identity-only",
  };
}

export function findItem7W5Site(ledgerId: string): Item7W5Site | null {
  return ITEM7_W5_SITES.find((site) => site.ledgerId === ledgerId) ?? null;
}

export function proveItem7W5IndexIdentity(params: {
  ledgerId: string;
  handleResourceId: string | null;
}): Item7W5IndexProof | null {
  const site = findItem7W5Site(params.ledgerId);
  if (!site) {
    return null;
  }
  const hit =
    typeof params.handleResourceId === "string" && params.handleResourceId.trim().length > 0;
  return {
    site,
    handleIdentity: hit ? "hit" : "miss",
    quarantine: !hit,
    indexSwitch: decideItem7W5IndexSwitch(),
    productionWrite: "legacy-only",
    catalogMissDeny: false,
  };
}

export function runItem7W5IndexShadow(params: {
  ledgerId: string;
  handleResourceId: string | null;
  env?: NodeJS.ProcessEnv;
}): Item7W5IndexProof | null {
  if (!isItem7W1DarkDualReadEnabled(params.env ?? process.env)) {
    return null;
  }
  return proveItem7W5IndexIdentity({
    ledgerId: params.ledgerId,
    handleResourceId: params.handleResourceId,
  });
}

export function scheduleItem7W5IndexShadow(params: {
  ledgerId: string;
  handleResourceId: string | null;
}): void {
  runItem7W5IndexShadow(params);
}

export function evaluateItem7W5MetRequest(): Item7MetDecision {
  return evaluateItem7MetRequest({
    liveWriteWatchIndex: ITEM7_LIVE_WRITE_WATCH_INDEX,
    independentRetirementReviewAccepted: false,
    rollbackProof: false,
    quarantineProof: false,
  });
}

export function item7W5ReplacementWriteStillTombstoned(): boolean {
  const decision = decideItem7W1Write({ kind: "replacement-new" });
  return !decision.allow && decision.action === "tombstone-quarantine";
}
