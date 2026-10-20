import {
  STAGE_D_SITES,
  type StageDBusinessPhase,
  type StageDSite,
} from "./item7-stage-d-memory-sync.js";
/**
 * Item 7 Stage D — S33/S34/S35 controlled cutover PREP (shadow/evidence-only).
 *
 * Composes the already-landed Stage D stack (controlled `syncMemoryAssets`,
 * persistent O_EXCL/CAS store, local-only staging adapter, dark shadow/canary,
 * production-readiness aggregator) into an auditable PREP packet:
 *   - per-site operation markers + operationId contract
 *   - cutover / rollback test matrix
 *   - three-site retirement DRAFT (never writes the canonical scan)
 *
 * This module performs NO production cutover. It never edits
 * `manager-sync-ops.ts` (owned by cursor-memory-wsc), never switches the
 * legacy `syncMemoryFiles` sites, never enables cloud/BYOS, never flips
 * `implementationVerified`, and never lowers remaining / liveWriteWatchIndex.
 * Production stays `productionWrite=legacy-only` /
 * `stageDControlledWrite=shadow-only`. `cutoverAuthorized` is pinned false.
 */
import { STAGE_D_PHASE_E_GATES, type StageDPhaseEGate } from "./item7-stage-d-readiness.js";
import { STAGE_D_CANARY_POINTS, type StageDCanaryPhase } from "./item7-stage-d-shadow-canary.js";

export const S33_S35_CUTOVER_PREP = "item7-stage-d-cutover-prep/v1" as const;

/** Line numbers of the three P8 `syncMemoryFiles` sites on origin/main
 * `e6dd9c61bc4cc0c3cf014075bfaab7adc86a6c89`. Verified, not guessed. */
export const S33_S35_LEGACY_LINES = {
  S33: 1062,
  S34: 1252,
  S35: 1343,
} as const;

export type CutoverPrepLocks = {
  productionWrite: "legacy-only";
  stageDControlledWrite: "shadow-only";
  cloudSyncEnabled: false;
  byosEnabled: false;
  cutoverAuthorized: false;
  implementationVerified: false;
  deployAuthorized: false;
  live: "forbidden";
  remaining: 10;
  liveWriteWatchIndex: 10;
};

/** Fail-closed locks for this PREP slice. Literals so the packet cannot
 * express a production switch, a remaining decrement, or LIVE. */
export const CUTOVER_PREP_LOCKS: CutoverPrepLocks = Object.freeze({
  productionWrite: "legacy-only",
  stageDControlledWrite: "shadow-only",
  cloudSyncEnabled: false,
  byosEnabled: false,
  cutoverAuthorized: false,
  implementationVerified: false,
  deployAuthorized: false,
  live: "forbidden",
  remaining: 10,
  liveWriteWatchIndex: 10,
});

export type StageDOperationMarker = {
  ledgerId: StageDSite["ledgerId"];
  point: StageDSite["point"];
  file: StageDSite["file"];
  symbol: StageDSite["symbol"];
  line: number;
  businessPhase: StageDBusinessPhase;
  canaryPhase: StageDCanaryPhase;
  operationAuth: StageDSite["operationAuth"];
  rollback: StageDSite["rollback"];
  /** Safe-token prefix for test/shadow operationIds (`[A-Za-z0-9._-]`). */
  operationIdPrefix: string;
  productionCallSiteStillLegacy: true;
};

function canaryPhaseForSite(ledgerId: StageDSite["ledgerId"]): StageDCanaryPhase {
  const found = STAGE_D_CANARY_POINTS.find((entry) => entry.point === ledgerId);
  if (!found) {
    throw new Error(`unknown_cutover_prep_point:${ledgerId}`);
  }
  return found.businessPhase;
}

/** Per-site operation marker. Metadata is sourced from STAGE_D_SITES + the
 * dark-canary phase table; line numbers are the verified origin/main sites. */
export const S33_S35_OPERATION_MARKERS: readonly StageDOperationMarker[] = STAGE_D_SITES.map(
  (site) => ({
    ledgerId: site.ledgerId,
    point: site.point,
    file: site.file,
    symbol: site.symbol,
    line: S33_S35_LEGACY_LINES[site.ledgerId],
    businessPhase: site.businessPhase,
    canaryPhase: canaryPhaseForSite(site.ledgerId),
    operationAuth: site.operationAuth,
    rollback: site.rollback,
    operationIdPrefix: `cutover-prep-${site.ledgerId}`,
    productionCallSiteStillLegacy: true as const,
  }),
);

/** Mint a safe operationId for isolated PREP tests. Never used as a host path. */
export function cutoverPrepOperationId(ledgerId: StageDSite["ledgerId"], nonce: string): string {
  const marker = S33_S35_OPERATION_MARKERS.find((row) => row.ledgerId === ledgerId);
  if (!marker) {
    throw new Error(`unknown_cutover_prep_ledger:${ledgerId}`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,64}$/.test(nonce)) {
    throw new Error(`invalid_cutover_prep_nonce:${nonce}`);
  }
  return `${marker.operationIdPrefix}-${nonce}`;
}

export type CutoverRollbackRow = {
  ledgerId: StageDSite["ledgerId"];
  businessPhase: StageDBusinessPhase;
  operationAuth: StageDSite["operationAuth"];
  rollback: StageDSite["rollback"];
  /** What a future authorized cutover WOULD do. Not executed by this PREP. */
  cutoverStep: string;
  /** How the site rolls back if that future cutover is aborted. */
  rollbackStep: string;
  executed: false;
  authorized: false;
  productionWrite: "legacy-only";
};

export const S33_S35_CUTOVER_ROLLBACK_MATRIX: readonly CutoverRollbackRow[] = [
  {
    ledgerId: "S33",
    businessPhase: "admission-import",
    operationAuth: "sync",
    rollback: "convergent-retry",
    cutoverStep:
      "Replace runSync incremental syncMemoryFiles with controlled syncMemoryAssets under operationAuth=sync (NOT performed in this PREP).",
    rollbackStep:
      "Keep legacy syncMemoryFiles; S33 retry is convergent (dirty flag + re-run). No Catalog rewind required.",
    executed: false,
    authorized: false,
    productionWrite: "legacy-only",
  },
  {
    ledgerId: "S34",
    businessPhase: "rebuild-reindex-safe",
    operationAuth: "rebuild",
    rollback: "atomic-temp-db-swap",
    cutoverStep:
      "Replace runSafeReindexInternal syncMemoryFiles with controlled syncMemoryAssets under operationAuth=rebuild (NOT performed in this PREP).",
    rollbackStep:
      "Keep legacy syncMemoryFiles; S34 already isolates via atomic temp-db swap. Abort leaves the original index in place.",
    executed: false,
    authorized: false,
    productionWrite: "legacy-only",
  },
  {
    ledgerId: "S35",
    businessPhase: "rebuild-reindex-unsafe",
    operationAuth: "rebuild",
    rollback: "in-place-reset",
    cutoverStep:
      "Replace runUnsafeReindexInternal syncMemoryFiles with controlled syncMemoryAssets under operationAuth=rebuild (NOT performed in this PREP).",
    rollbackStep:
      "Keep legacy syncMemoryFiles. S35 is in-place reset (higher risk); stay legacy until S34 shadow-match is proven and owner coordination lands.",
    executed: false,
    authorized: false,
    productionWrite: "legacy-only",
  },
];

export type ThreeSiteRetirementDraft = {
  kind: "draft-only";
  canonicalScanPath: "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json";
  canonicalScanTouched: false;
  applied: false;
  proposedRetiredLedgerIds: readonly ["S33", "S34", "S35"];
  proposedRetiredThisSlice: 3;
  /** 10 live sites minus the three P8 sites — NOT applied. */
  proposedRemaining: 7;
  proposedLiveWriteWatchIndex: 7;
  remainingUnchanged: 10;
  liveWriteWatchIndexUnchanged: 10;
  requiresOwnerCoordination: true;
  siteOwner: "cursor-memory-wsc";
  blockedBy: readonly StageDPhaseEGate[];
};

/** Retirement DRAFT for S33/S34/S35. Explicitly does not mutate the canonical
 * scan; remaining and liveWriteWatchIndex stay 10. */
export const S33_S35_RETIREMENT_DRAFT: ThreeSiteRetirementDraft = Object.freeze({
  kind: "draft-only",
  canonicalScanPath: "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json",
  canonicalScanTouched: false,
  applied: false,
  proposedRetiredLedgerIds: ["S33", "S34", "S35"] as const,
  proposedRetiredThisSlice: 3,
  proposedRemaining: 7,
  proposedLiveWriteWatchIndex: 7,
  remainingUnchanged: 10,
  liveWriteWatchIndexUnchanged: 10,
  requiresOwnerCoordination: true,
  siteOwner: "cursor-memory-wsc",
  blockedBy: STAGE_D_PHASE_E_GATES,
});

export type CutoverPrepSnapshot = CutoverPrepLocks & {
  schema: typeof S33_S35_CUTOVER_PREP;
  stage: "D";
  item7: "not-met";
  phase1bUnlock: "not-issued";
  siteOwner: "cursor-memory-wsc";
  ownerCoordinationPending: true;
  markers: readonly StageDOperationMarker[];
  matrix: readonly CutoverRollbackRow[];
  retirementDraft: ThreeSiteRetirementDraft;
  remainingBlockers: readonly StageDPhaseEGate[];
};

/** Pure PREP snapshot. Never authorizes or performs a cutover. */
export function evaluateS33S35CutoverPrep(): CutoverPrepSnapshot {
  return {
    schema: S33_S35_CUTOVER_PREP,
    stage: "D",
    item7: "not-met",
    phase1bUnlock: "not-issued",
    siteOwner: "cursor-memory-wsc",
    ownerCoordinationPending: true,
    ...CUTOVER_PREP_LOCKS,
    markers: S33_S35_OPERATION_MARKERS,
    matrix: S33_S35_CUTOVER_ROLLBACK_MATRIX,
    retirementDraft: S33_S35_RETIREMENT_DRAFT,
    remainingBlockers: STAGE_D_PHASE_E_GATES,
  };
}
