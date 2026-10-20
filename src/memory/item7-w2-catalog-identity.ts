/**
 * Item 7 W2: prove Catalog identity for P1/P3 write callers in shadow.
 * Production writes stay on the 16 legacy sites. Caller switch, deletion,
 * Catalog miss=deny, and Item 7 met stay forbidden.
 *
 * Does not call resolveAgentWorkspaceDir / resolveAgentWorkspaceDirForClient.
 */
import {
  compareItem7W1DualRead,
  decideItem7W1Write,
  evaluateItem7MetRequest,
  ITEM7_LIVE_WRITE_WATCH_INDEX,
  type Item7MetDecision,
  type Item7W1DualReadResult,
} from "./item7-w1-dark-tombstone.js";

export const ITEM7_W2_WAVE = "W2" as const;
export const ITEM7_W2_CATALOG_MISS_DENY = false;
export const ITEM7_W2_DELETE_CALL_SITES = false;
export const ITEM7_W2_WIRED_TO_PRODUCTION_RESOLVER = false;
export const ITEM7_W2_SITE_COUNT = 16;

export type Item7W2PathId = "P1" | "P3";

export type Item7W2Site = {
  ledgerId: string;
  pathId: Item7W2PathId;
  file: string;
  symbol: "resolveAgentWorkspaceDir" | "resolveAgentWorkspaceDirForClient";
  replacementSymbol: "resolveWorkspaceResource";
};

export const ITEM7_W2_SITES: readonly Item7W2Site[] = [
  {
    ledgerId: "S02",
    pathId: "P1",
    file: "src/auto-reply/reply/get-reply.ts",
    symbol: "resolveAgentWorkspaceDir",
    replacementSymbol: "resolveWorkspaceResource",
  },
  {
    ledgerId: "S03",
    pathId: "P3",
    file: "src/commands/agent.ts",
    symbol: "resolveAgentWorkspaceDirForClient",
    replacementSymbol: "resolveWorkspaceResource",
  },
  {
    ledgerId: "S04",
    pathId: "P1",
    file: "src/commands/status-all/agents.ts",
    symbol: "resolveAgentWorkspaceDir",
    replacementSymbol: "resolveWorkspaceResource",
  },
  {
    ledgerId: "S05",
    pathId: "P1",
    file: "src/gateway/checkpoint-store.ts",
    symbol: "resolveAgentWorkspaceDir",
    replacementSymbol: "resolveWorkspaceResource",
  },
  {
    ledgerId: "S07",
    pathId: "P3",
    file: "src/gateway/checkpoint-store.ts",
    symbol: "resolveAgentWorkspaceDirForClient",
    replacementSymbol: "resolveWorkspaceResource",
  },
  {
    ledgerId: "S10",
    pathId: "P1",
    file: "src/gateway/server-methods/agents.ts",
    symbol: "resolveAgentWorkspaceDir",
    replacementSymbol: "resolveWorkspaceResource",
  },
  {
    ledgerId: "S11",
    pathId: "P1",
    file: "src/gateway/server-methods/agents.ts",
    symbol: "resolveAgentWorkspaceDir",
    replacementSymbol: "resolveWorkspaceResource",
  },
  {
    ledgerId: "S12",
    pathId: "P1",
    file: "src/gateway/server-methods/agents.ts",
    symbol: "resolveAgentWorkspaceDir",
    replacementSymbol: "resolveWorkspaceResource",
  },
  {
    ledgerId: "S13",
    pathId: "P1",
    file: "src/gateway/server-methods/agents.ts",
    symbol: "resolveAgentWorkspaceDir",
    replacementSymbol: "resolveWorkspaceResource",
  },
  {
    ledgerId: "S14",
    pathId: "P1",
    file: "src/gateway/server-methods/agents.ts",
    symbol: "resolveAgentWorkspaceDir",
    replacementSymbol: "resolveWorkspaceResource",
  },
  {
    ledgerId: "S15",
    pathId: "P1",
    file: "src/gateway/server-methods/agents.ts",
    symbol: "resolveAgentWorkspaceDir",
    replacementSymbol: "resolveWorkspaceResource",
  },
  {
    ledgerId: "S16",
    pathId: "P3",
    file: "src/gateway/server-methods/chat.ts",
    symbol: "resolveAgentWorkspaceDirForClient",
    replacementSymbol: "resolveWorkspaceResource",
  },
  {
    ledgerId: "S18",
    pathId: "P3",
    file: "src/gateway/server-methods/skills.ts",
    symbol: "resolveAgentWorkspaceDirForClient",
    replacementSymbol: "resolveWorkspaceResource",
  },
  {
    ledgerId: "S19",
    pathId: "P3",
    file: "src/gateway/server-methods/skills.ts",
    symbol: "resolveAgentWorkspaceDirForClient",
    replacementSymbol: "resolveWorkspaceResource",
  },
  {
    ledgerId: "S20",
    pathId: "P3",
    file: "src/gateway/server-methods/tools-catalog.ts",
    symbol: "resolveAgentWorkspaceDirForClient",
    replacementSymbol: "resolveWorkspaceResource",
  },
  {
    ledgerId: "S29",
    pathId: "P3",
    file: "src/gateway/workspace/handler-bridge.ts",
    symbol: "resolveAgentWorkspaceDirForClient",
    replacementSymbol: "resolveWorkspaceResource",
  },
];

export type Item7W2CallerSwitchDecision = {
  allow: false;
  action: "keep-legacy-call";
  reason: "w2-shadow-catalog-identity-only";
  wiredToProductionResolver: false;
};

export type Item7W2CatalogProof = {
  site: Item7W2Site;
  catalogIdentity: "hit" | "miss";
  dualRead: Item7W1DualReadResult;
  callerSwitch: Item7W2CallerSwitchDecision;
  productionWrite: "legacy-only";
  catalogMissDeny: false;
};

export function decideItem7W2CallerSwitch(): Item7W2CallerSwitchDecision {
  return {
    allow: false,
    action: "keep-legacy-call",
    reason: "w2-shadow-catalog-identity-only",
    wiredToProductionResolver: false,
  };
}

export function findItem7W2Site(ledgerId: string): Item7W2Site | null {
  return ITEM7_W2_SITES.find((site) => site.ledgerId === ledgerId) ?? null;
}

export function proveItem7W2CatalogIdentity(params: {
  ledgerId: string;
  catalogResourceId: string | null;
  legacyLocator: string | null;
}): Item7W2CatalogProof | null {
  const site = findItem7W2Site(params.ledgerId);
  if (!site) {
    return null;
  }
  const dualRead = compareItem7W1DualRead({
    legacyLocator: params.legacyLocator,
    replacementResourceId: params.catalogResourceId,
  });
  return {
    site,
    catalogIdentity: params.catalogResourceId ? "hit" : "miss",
    dualRead,
    callerSwitch: decideItem7W2CallerSwitch(),
    productionWrite: "legacy-only",
    catalogMissDeny: false,
  };
}

export function evaluateItem7W2MetRequest(): Item7MetDecision {
  return evaluateItem7MetRequest({
    liveWriteWatchIndex: ITEM7_LIVE_WRITE_WATCH_INDEX,
    independentRetirementReviewAccepted: false,
    rollbackProof: false,
    quarantineProof: false,
  });
}

export function item7W2ReplacementWriteStillTombstoned(): boolean {
  const decision = decideItem7W1Write({ kind: "replacement-new" });
  return !decision.allow && decision.action === "tombstone-quarantine";
}
