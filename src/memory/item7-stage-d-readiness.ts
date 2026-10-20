/**
 * Item 7 Stage D — production-readiness assessment (read-only, shadow/evidence-only).
 *
 * The Stage D shadow stack is already landed: the controlled `syncMemoryAssets`
 * command (memory-sync), the persistent O_EXCL/CAS fencing + recovery store, the
 * local-only staging->verify->atomic-publish adapter, and the dark shadow/canary
 * that does a read-only identity comparison for the three S33/S34/S35
 * `syncMemoryFiles` call-sites in `manager-sync-ops.ts`.
 *
 * This module does NOT add any new production behavior. It is a pure aggregator
 * that turns (a) the dark canary's per-point identity signal and (b) a snapshot
 * of the remaining Phase E governance gates into an auditable per-site readiness
 * verdict + an enumerated list of the blockers that still stand between the
 * shadow and a real cutover. It is the honest Phase E cutover INPUT — it never
 * retires S33/S34/S35, never touches `manager-sync-ops.ts` (owned by
 * cursor-memory-wsc), never switches the legacy production sync, never enables
 * cloud/BYOS, and never mints a Catalog binding.
 *
 * The report type deliberately pins `productionWrite: "legacy-only"`,
 * `stageDControlledWrite: "shadow-only"`, and `cloudSyncEnabled/byosEnabled:
 * false` as literals so the assessment can never express a production switch.
 * `cutoverAuthorized` is computed (never hard-coded true): it can only be true
 * when every point's shadow matches AND every Phase E gate is satisfied — and
 * even then this module performs no cutover, it only reports eligibility.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { writeJsonDurable } from "../gateway/data-governance/cognitive-file-lock.js";
import {
  STAGE_D_SITES,
  type StageDBusinessPhase,
  type StageDSite,
} from "./item7-stage-d-memory-sync.js";
import type { StageDCanaryPoint, StageDCanaryReceipt } from "./item7-stage-d-shadow-canary.js";

export const ITEM7_STAGE_D_READINESS = "item7-stage-d-readiness/v1" as const;

export type StageDReadinessPoint = StageDCanaryPoint; // "S33" | "S34" | "S35"

/**
 * The governance gates that must ALL hold before any real Stage D cutover. Each
 * is independently checkable; in the current phase they are open by design.
 */
export type StageDPhaseEGate =
  | "phase1b_unlock_issued"
  | "live_write_watch_index_zero"
  | "site_owner_coordination"
  | "site_retired_from_scan"
  | "operator_cutover_authorization";

export const STAGE_D_PHASE_E_GATES: readonly StageDPhaseEGate[] = [
  "phase1b_unlock_issued",
  "live_write_watch_index_zero",
  "site_owner_coordination",
  "site_retired_from_scan",
  "operator_cutover_authorization",
];

/** Human-readable, operator-facing description of each gate (for the report). */
export const STAGE_D_GATE_DESCRIPTIONS: Record<StageDPhaseEGate, string> = {
  phase1b_unlock_issued: "Phase 1B unlock has been formally issued",
  live_write_watch_index_zero: "canonical retirement-scan liveWriteWatchIndex is 0",
  site_owner_coordination:
    "manager-sync-ops.ts owner (cursor-memory-wsc) has signed off on the S33/S34/S35 cutover",
  site_retired_from_scan: "S33/S34/S35 have been retired from the canonical retirement scan",
  operator_cutover_authorization: "operator has explicitly authorized the LIVE cutover",
};

/**
 * Per-point shadow signal. "not-exercised" means the dark canary was not run for
 * the point (dark flag off / no receipt) — the production default; it is NOT a
 * pass. Only "match" counts as shadow-ready.
 */
export type StageDShadowSignal = "match" | "mismatch" | "not-executed" | "not-exercised";

export type StageDReadinessGateSnapshot = {
  /** Phase 1B unlock has been formally issued. */
  phase1bUnlockIssued: boolean;
  /** Canonical retirement-scan liveWriteWatchIndex (must be 0 before any cutover). */
  liveWriteWatchIndex: number;
  /** The owner of manager-sync-ops.ts (cursor-memory-wsc) has signed off on cutover. */
  siteOwnerCoordinationConfirmed: boolean;
  /** S33/S34/S35 have been retired from the canonical retirement scan. */
  sitesRetiredFromScan: boolean;
  /** Operator has explicitly authorized the LIVE cutover. */
  operatorCutoverAuthorized: boolean;
};

export type StageDReadinessVerdict =
  | "shadow-not-ready" // the dark canary did not produce an identity match for this point
  | "shadow-ready-pending-cutover" // shadow matches; only the Phase E governance gates remain
  | "cutover-eligible"; // shadow matches AND every Phase E gate holds (this module still performs no cutover)

export type StageDPointReadiness = {
  point: StageDReadinessPoint; // ledger id S33/S34/S35
  dPoint: StageDSite["point"]; // D1/D2/D3
  file: StageDSite["file"];
  symbol: StageDSite["symbol"];
  businessPhase: StageDBusinessPhase;
  operationAuth: StageDSite["operationAuth"];
  rollback: StageDSite["rollback"];
  shadowSignal: StageDShadowSignal;
  shadowReady: boolean;
  pendingGates: StageDPhaseEGate[];
  verdict: StageDReadinessVerdict;
};

export type StageDReadinessReport = {
  schema: typeof ITEM7_STAGE_D_READINESS;
  stage: "D";
  productionWrite: "legacy-only";
  stageDControlledWrite: "shadow-only";
  cutoverAuthorized: boolean;
  points: StageDPointReadiness[];
  /** De-duped union of every pending Phase E gate across all points. */
  remainingBlockers: StageDPhaseEGate[];
  cloudSyncEnabled: false;
  byosEnabled: false;
  createdAt: string;
};

export type StageDReadinessInput = {
  gates: StageDReadinessGateSnapshot;
  /**
   * Dark-canary receipts (from `runStageDLocalOnlyCanary`), at most one per
   * point. A point with no receipt is treated as "not-exercised" (dark off / not
   * run) — never as ready.
   */
  canaryReceipts?: readonly StageDCanaryReceipt[];
  now?: () => string;
};

/** Pending Phase E gates for a snapshot (pure). Order follows STAGE_D_PHASE_E_GATES. */
export function pendingPhaseEGates(snapshot: StageDReadinessGateSnapshot): StageDPhaseEGate[] {
  const pending: StageDPhaseEGate[] = [];
  if (!snapshot.phase1bUnlockIssued) {
    pending.push("phase1b_unlock_issued");
  }
  if (snapshot.liveWriteWatchIndex !== 0) {
    pending.push("live_write_watch_index_zero");
  }
  if (!snapshot.siteOwnerCoordinationConfirmed) {
    pending.push("site_owner_coordination");
  }
  if (!snapshot.sitesRetiredFromScan) {
    pending.push("site_retired_from_scan");
  }
  if (!snapshot.operatorCutoverAuthorized) {
    pending.push("operator_cutover_authorization");
  }
  return pending;
}

/** Map an optional canary receipt for a point to a shadow signal. Absent => not-exercised. */
export function deriveShadowSignal(receipt: StageDCanaryReceipt | undefined): StageDShadowSignal {
  if (!receipt) {
    return "not-exercised";
  }
  return receipt.identityComparison;
}

/**
 * Aggregate the per-point dark-canary signal and the Phase E gate snapshot into
 * an auditable readiness report. Pure and read-only: it composes only the
 * already-landed Stage D pieces and never performs, authorizes, or fakes a
 * cutover. `cutoverAuthorized` is TRUE only if every point is shadow-ready AND
 * no Phase E gate remains — an assessment, not an action.
 */
export function evaluateStageDProductionReadiness(
  input: StageDReadinessInput,
): StageDReadinessReport {
  const now = input.now ?? (() => new Date().toISOString());

  // Index receipts by point; keep the first per point for determinism.
  const receiptByPoint = new Map<StageDReadinessPoint, StageDCanaryReceipt>();
  for (const receipt of input.canaryReceipts ?? []) {
    if (!receiptByPoint.has(receipt.point)) {
      receiptByPoint.set(receipt.point, receipt);
    }
  }

  const globalPendingGates = pendingPhaseEGates(input.gates);

  const points: StageDPointReadiness[] = STAGE_D_SITES.map((site) => {
    const shadowSignal = deriveShadowSignal(receiptByPoint.get(site.ledgerId));
    const shadowReady = shadowSignal === "match";
    // The Phase E gates are global (not per-point); the per-point verdict
    // combines the shared gate set with this point's own shadow signal.
    const pendingGates = [...globalPendingGates];
    let verdict: StageDReadinessVerdict;
    if (!shadowReady) {
      verdict = "shadow-not-ready";
    } else if (pendingGates.length > 0) {
      verdict = "shadow-ready-pending-cutover";
    } else {
      verdict = "cutover-eligible";
    }
    return {
      point: site.ledgerId,
      dPoint: site.point,
      file: site.file,
      symbol: site.symbol,
      businessPhase: site.businessPhase,
      operationAuth: site.operationAuth,
      rollback: site.rollback,
      shadowSignal,
      shadowReady,
      pendingGates,
      verdict,
    };
  });

  // Cutover is authorized ONLY when every point is shadow-ready AND no Phase E
  // gate remains. In the current phase the governance gates are open by design,
  // so this is false; this module never itself performs a cutover.
  const cutoverAuthorized =
    points.length > 0 &&
    points.every((point) => point.shadowReady) &&
    globalPendingGates.length === 0;

  return {
    schema: ITEM7_STAGE_D_READINESS,
    stage: "D",
    productionWrite: "legacy-only",
    stageDControlledWrite: "shadow-only",
    cutoverAuthorized,
    points,
    remainingBlockers: globalPendingGates,
    cloudSyncEnabled: false,
    byosEnabled: false,
    createdAt: now(),
  };
}

/**
 * Persist a readiness report durably under a governed path (auditable Phase E
 * input). Writes only under the controlled stage-d-sync/readiness root — never a
 * production Catalog and never a caller-supplied path. Returns the file path.
 */
export function writeStageDReadinessReport(
  report: StageDReadinessReport,
  opts: { stateDir?: string } = {},
): string {
  const root = path.join(
    path.resolve(opts.stateDir ?? resolveStateDir()),
    "data-governance",
    "stage-d-sync",
    "readiness",
  );
  fs.mkdirSync(root, { recursive: true });
  const safeStamp = report.createdAt.replace(/[^0-9A-Za-z]/g, "-");
  const dest = path.join(root, `readiness-${safeStamp}.json`);
  const rel = path.relative(root, dest);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("invalid_readiness_report_path");
  }
  writeJsonDurable(dest, report);
  return dest;
}
