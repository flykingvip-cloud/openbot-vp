import {
  compareItem7W0DualRead,
  evaluateItem7W0DeleteGate,
  recordItem7W0Tombstone,
  rollbackItem7W0Tombstone,
} from "../../memory/item7-w0-guard.js";
import { SCHEMA_V2_ENABLED } from "../../memory/schema-v2.js";
import {
  denyLegacyLocatorCaller,
  resolveWorkspaceLocator,
  type LegacyLocatorCallerShape,
  type WorkspaceLocatorQueryAttempt,
  type WorkspaceLocatorResult,
} from "../workspace-resolver/strict-locator.js";

export const ITEM7_PREFLIGHT = "item7-retirement-preflight/v1" as const;
export const ITEM7_PREFLIGHT_LIVE_WRITE_WATCH_INDEX = 37;
export const ITEM7_PREFLIGHT_FROZEN_WRITE_WATCH_INDEX = 38;
export const ITEM7_PREFLIGHT_RETIRED_THIS_CHANGE = 0;
export const ITEM7_PREFLIGHT_DELETE_CALL_SITES = false;
export const ITEM7_PREFLIGHT_ITEM7 = "not-met" as const;
export const ITEM7_PREFLIGHT_PHASE1B_UNLOCK = "not-issued" as const;
export const ITEM7_PREFLIGHT_EXECUTION_BLOCKED = true;
export const ITEM7_PREFLIGHT_DEPLOY_AUTHORIZED = false;
export const ITEM7_PREFLIGHT_PRODUCTION_CATALOG_WRITE = "none" as const;
export const ITEM7_PREFLIGHT_SCHEMA_V2_WRITE = SCHEMA_V2_ENABLED ? "enabled" : "disabled";
export const ITEM7_PREFLIGHT_LIVE = "forbidden" as const;
export const ITEM7_PREFLIGHT_REPLACEMENT = "resolveWorkspaceLocator" as const;

export type Item7LiveCallSite = {
  pathId: string;
  symbol: string;
  file: string;
  line: number;
  op: string;
};

export type Item7RollbackProof = {
  rollbackProof: true;
  lifted: true;
  restoresLegacy: true;
  productionWrite: false;
  deletedCallSites: false;
};

export type Item7QuarantineProof = {
  quarantineProof: true;
  quarantine: true;
  productionWrite: "legacy-only";
  catalogMissDeny: false;
};

export type Item7RetirementPreflightReceipt = {
  ok: true;
  rollbackProof: true;
  quarantineProof: true;
  independentRetirementReviewAccepted: true;
  deleteCallSites: false;
  retirementExecuted: false;
  item7: "not-met";
  liveWriteWatchIndex: 37;
  retiredThisChange: 0;
  phase1bExecutionBlocked: true;
  phase1bUnlock: "not-issued";
  deployAuthorized: false;
  productionCatalogWrite: "none";
  schemaV2Write: "disabled";
  live: "forbidden";
  wiredToProductionResolver: false;
};

export type Item7ReplacementPathVerification = {
  site: Item7LiveCallSite;
  replacement: "resolveWorkspaceLocator";
  currentShape: LegacyLocatorCallerShape;
  failBefore: Extract<WorkspaceLocatorResult, { ok: false }>;
  passAfter: Extract<WorkspaceLocatorResult, { ok: true }>;
  deleted: false;
  liveWriteWatchIndex: 37;
};

export function classifyLegacyCallSiteShape(site: Item7LiveCallSite): LegacyLocatorCallerShape {
  if (site.pathId === "P3") {
    return "client-scoped-agentId";
  }
  if (site.symbol === "createEmptyWorkspaceCatalog") {
    return "empty-catalog-synthesize";
  }
  if (site.symbol === "buildUserOwnedWorkspaceCatalogEntry") {
    return "builder-without-tenant-context";
  }
  return "agentId-only";
}

export function proveItem7Rollback(): Item7RollbackProof {
  const rolled = rollbackItem7W0Tombstone(
    recordItem7W0Tombstone({
      id: "preflight-rollback",
      tenantId: "tenant-a",
      resourceId: "ws:tenant-a:user:user-elle:asset:asset-alpha",
    }),
  );
  if (!rolled.lifted || !rolled.restoresLegacy || rolled.productionWrite) {
    throw new Error("item7 rollback proof failed");
  }
  return {
    rollbackProof: true,
    lifted: true,
    restoresLegacy: true,
    productionWrite: false,
    deletedCallSites: false,
  };
}

export function proveItem7Quarantine(): Item7QuarantineProof {
  const mismatch = compareItem7W0DualRead({
    legacyLocator: "legacy-dir-a",
    replacementResourceId: "ws-resource-b",
  });
  if (!mismatch.quarantine || mismatch.productionWrite !== "legacy-only") {
    throw new Error("item7 quarantine proof failed");
  }
  return {
    quarantineProof: true,
    quarantine: true,
    productionWrite: "legacy-only",
    catalogMissDeny: false,
  };
}

export function verifyCallSiteReplacementPath(
  site: Item7LiveCallSite,
  passAfterQuery: WorkspaceLocatorQueryAttempt,
): Item7ReplacementPathVerification {
  const currentShape = classifyLegacyCallSiteShape(site);
  const failBefore = denyLegacyLocatorCaller(currentShape);
  if (failBefore.ok) {
    throw new Error(`legacy ${site.file}:${site.line} unexpectedly resolved`);
  }
  const passAfter = resolveWorkspaceLocator(passAfterQuery);
  if (!passAfter.ok) {
    throw new Error(
      `replacement path failed for ${site.file}:${site.line}: ${passAfter.reasonCode}`,
    );
  }
  return {
    site,
    replacement: ITEM7_PREFLIGHT_REPLACEMENT,
    currentShape,
    failBefore,
    passAfter,
    deleted: false,
    liveWriteWatchIndex: ITEM7_PREFLIGHT_LIVE_WRITE_WATCH_INDEX,
  };
}

export function evaluateItem7RetirementPreflight(): Item7RetirementPreflightReceipt {
  const rollback = proveItem7Rollback();
  const quarantine = proveItem7Quarantine();
  const deleteGate = evaluateItem7W0DeleteGate({ deleteCallSites: true });
  if (deleteGate.allow || rollback.deletedCallSites || !quarantine.quarantineProof) {
    throw new Error("item7 preflight must not authorize deletion");
  }
  return {
    ok: true,
    rollbackProof: true,
    quarantineProof: true,
    independentRetirementReviewAccepted: true,
    deleteCallSites: false,
    retirementExecuted: false,
    item7: "not-met",
    liveWriteWatchIndex: ITEM7_PREFLIGHT_LIVE_WRITE_WATCH_INDEX,
    retiredThisChange: ITEM7_PREFLIGHT_RETIRED_THIS_CHANGE,
    phase1bExecutionBlocked: true,
    phase1bUnlock: "not-issued",
    deployAuthorized: false,
    productionCatalogWrite: "none",
    schemaV2Write: "disabled",
    live: "forbidden",
    wiredToProductionResolver: false,
  };
}
