/**
 * Item 7 W3: prove P4 catalog synthesis can be replaced by Catalog
 * getResource in shadow. Empty-catalog / builder call-sites stay.
 * Production Catalog write, miss=deny, deletion, and Item 7 met stay
 * forbidden.
 *
 * Does not call createEmptyWorkspaceCatalog /
 * buildUserOwnedWorkspaceCatalogEntry.
 */
import {
  decideItem7W1Write,
  evaluateItem7MetRequest,
  isItem7W1DarkDualReadEnabled,
  ITEM7_LIVE_WRITE_WATCH_INDEX,
  type Item7MetDecision,
} from "./item7-w1-dark-tombstone.js";

export const ITEM7_W3_WAVE = "W3" as const;
export const ITEM7_W3_CATALOG_MISS_DENY = false;
export const ITEM7_W3_DELETE_CALL_SITES = false;
export const ITEM7_W3_PRODUCTION_CATALOG_WRITE = false;
export const ITEM7_W3_SITE_COUNT = 7;

export type Item7W3Symbol = "createEmptyWorkspaceCatalog" | "buildUserOwnedWorkspaceCatalogEntry";

export type Item7W3Site = {
  ledgerId: string;
  pathId: "P4";
  file: string;
  symbol: Item7W3Symbol;
  replacementSymbol: "WorkspaceResourceCatalog.getResource";
};

export const ITEM7_W3_SITES: readonly Item7W3Site[] = [
  {
    ledgerId: "S08",
    pathId: "P4",
    file: "src/gateway/knowledge/deliverables/maybe-auto-capture-agent-deliverable.ts",
    symbol: "createEmptyWorkspaceCatalog",
    replacementSymbol: "WorkspaceResourceCatalog.getResource",
  },
  {
    ledgerId: "S09",
    pathId: "P4",
    file: "src/gateway/knowledge/knowledge-document-preview.ts",
    symbol: "createEmptyWorkspaceCatalog",
    replacementSymbol: "WorkspaceResourceCatalog.getResource",
  },
  {
    ledgerId: "S17",
    pathId: "P4",
    file: "src/gateway/server-methods/group-workspace-file.ts",
    symbol: "createEmptyWorkspaceCatalog",
    replacementSymbol: "WorkspaceResourceCatalog.getResource",
  },
  {
    ledgerId: "S21",
    pathId: "P4",
    file: "src/gateway/workspace-resolver/builders.ts",
    symbol: "buildUserOwnedWorkspaceCatalogEntry",
    replacementSymbol: "WorkspaceResourceCatalog.getResource",
  },
  {
    ledgerId: "S22",
    pathId: "P4",
    file: "src/gateway/workspace-resolver/steward-read.ts",
    symbol: "buildUserOwnedWorkspaceCatalogEntry",
    replacementSymbol: "WorkspaceResourceCatalog.getResource",
  },
  {
    ledgerId: "S23",
    pathId: "P4",
    file: "src/gateway/workspace-resolver/steward-write.ts",
    symbol: "createEmptyWorkspaceCatalog",
    replacementSymbol: "WorkspaceResourceCatalog.getResource",
  },
  {
    ledgerId: "S28",
    pathId: "P4",
    file: "src/gateway/workspace-resolver/tool-cwd.ts",
    symbol: "buildUserOwnedWorkspaceCatalogEntry",
    replacementSymbol: "WorkspaceResourceCatalog.getResource",
  },
];

export type Item7W3SynthesisSwitchDecision = {
  allow: false;
  action: "keep-legacy-synthesis";
  reason: "w3-shadow-catalog-read-only";
  productionCatalogWrite: false;
};

export type Item7W3CatalogProof = {
  site: Item7W3Site;
  replacementRead: "hit" | "miss";
  quarantine: boolean;
  synthesisSwitch: Item7W3SynthesisSwitchDecision;
  productionWrite: "legacy-only";
  catalogMissDeny: false;
};

export function decideItem7W3SynthesisSwitch(): Item7W3SynthesisSwitchDecision {
  return {
    allow: false,
    action: "keep-legacy-synthesis",
    reason: "w3-shadow-catalog-read-only",
    productionCatalogWrite: false,
  };
}

export function findItem7W3Site(ledgerId: string): Item7W3Site | null {
  return ITEM7_W3_SITES.find((site) => site.ledgerId === ledgerId) ?? null;
}

export function proveItem7W3CatalogRead(params: {
  ledgerId: string;
  existingResourceId: string | null;
}): Item7W3CatalogProof | null {
  const site = findItem7W3Site(params.ledgerId);
  if (!site) {
    return null;
  }
  const hit =
    typeof params.existingResourceId === "string" && params.existingResourceId.trim().length > 0;
  return {
    site,
    replacementRead: hit ? "hit" : "miss",
    quarantine: !hit,
    synthesisSwitch: decideItem7W3SynthesisSwitch(),
    productionWrite: "legacy-only",
    catalogMissDeny: false,
  };
}

export function runItem7W3CatalogSynthesisShadow(params: {
  ledgerId: string;
  existingResourceId: string | null;
  env?: NodeJS.ProcessEnv;
}): Item7W3CatalogProof | null {
  if (!isItem7W1DarkDualReadEnabled(params.env ?? process.env)) {
    return null;
  }
  return proveItem7W3CatalogRead({
    ledgerId: params.ledgerId,
    existingResourceId: params.existingResourceId,
  });
}

export function scheduleItem7W3CatalogSynthesisShadow(params: {
  ledgerId: string;
  existingResourceId: string | null;
}): void {
  runItem7W3CatalogSynthesisShadow(params);
}

export function evaluateItem7W3MetRequest(): Item7MetDecision {
  return evaluateItem7MetRequest({
    liveWriteWatchIndex: ITEM7_LIVE_WRITE_WATCH_INDEX,
    independentRetirementReviewAccepted: false,
    rollbackProof: false,
    quarantineProof: false,
  });
}

export function item7W3ReplacementWriteStillTombstoned(): boolean {
  const decision = decideItem7W1Write({ kind: "replacement-new" });
  return !decision.allow && decision.action === "tombstone-quarantine";
}
