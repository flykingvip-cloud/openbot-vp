/**
 * Item 7 Stage D — dark local-only shadow / canary.
 *
 * Runs the controlled local-only sync (`syncMemoryAssets` + persistent store +
 * local staging adapter) against an ISOLATED, non-production fixture and does a
 * READ-ONLY identity comparison against the legacy expectation. It NEVER touches
 * the three S33/S34/S35 legacy `syncMemoryFiles` call-sites, never writes the
 * production Catalog, and never enables cloud/BYOS. Production stays
 * `productionWrite=legacy-only` / `stageDControlledWrite=shadow-only`.
 *
 * A shadow mismatch => `quarantine=true`, production continues legacy-only, no
 * automatic Catalog correction, no automatic copy, and an auditable mismatch
 * receipt is produced (persist via `writeStageDCanaryReceipt`).
 *
 * Env-gated (dark): only runs under the Item 7 dark dual-read flag; the
 * production default is a complete no-op. Exercised by tests only in this slice.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { writeJsonDurable } from "../gateway/data-governance/cognitive-file-lock.js";
import { assertSafeRecoveryReceiptToken } from "../gateway/data-governance/recovery-receipt.js";
import {
  syncMemoryAssets,
  type StageDSyncDecision,
  type SyncMemoryAssetsInput,
  type SyncMemoryAssetsPorts,
} from "./item7-stage-d-memory-sync.js";
import { isItem7W1DarkDualReadEnabled } from "./item7-w1-dark-tombstone.js";

export const STAGE_D_CANARY = "item7-stage-d-shadow-canary/v1" as const;

export type StageDCanaryPoint = "S33" | "S34" | "S35";
export type StageDCanaryPhase = "admission-import" | "safe-rebuild" | "unsafe-rebuild";

/** The three P8 sites, each with its distinct business phase. The canary keeps a
 * separate receipt per point — they are NOT treated as identical. */
export const STAGE_D_CANARY_POINTS: ReadonlyArray<{
  point: StageDCanaryPoint;
  businessPhase: StageDCanaryPhase;
}> = [
  { point: "S33", businessPhase: "admission-import" },
  { point: "S34", businessPhase: "safe-rebuild" },
  { point: "S35", businessPhase: "unsafe-rebuild" },
];

export function canaryPhaseFor(point: StageDCanaryPoint): StageDCanaryPhase {
  const found = STAGE_D_CANARY_POINTS.find((entry) => entry.point === point);
  if (!found) {
    throw new Error(`unknown_stage_d_canary_point:${point}`);
  }
  return found.businessPhase;
}

export type StageDCanaryReceipt = {
  schema: typeof STAGE_D_CANARY;
  point: StageDCanaryPoint;
  businessPhase: StageDCanaryPhase;
  operationId: string;
  controlledSyncStatus: StageDSyncDecision["status"];
  syncedSha256: string | null;
  expectedSha256: string;
  identityComparison: "match" | "mismatch" | "not-executed";
  quarantine: boolean;
  productionWrite: "legacy-only";
  stageDControlledWrite: "shadow-only";
  cloudSyncEnabled: false;
  byosEnabled: false;
  createdAt: string;
};

export type StageDCanaryInput = {
  point: StageDCanaryPoint;
  sync: SyncMemoryAssetsInput;
  /** Legacy/source identity the controlled result is compared against (read-only). */
  expectedSha256: string;
  env?: NodeJS.ProcessEnv;
  now?: () => string;
};

/**
 * Dark canary for one point. Returns null when the dark dual-read flag is off
 * (production default). Never throws into a caller's sync path; a controlled
 * sync failure is reflected in the receipt, not raised.
 */
export async function runStageDLocalOnlyCanary(
  input: StageDCanaryInput,
  ports: SyncMemoryAssetsPorts,
): Promise<StageDCanaryReceipt | null> {
  if (!isItem7W1DarkDualReadEnabled(input.env ?? process.env)) {
    return null;
  }
  const now = input.now ?? (() => new Date().toISOString());
  const businessPhase = canaryPhaseFor(input.point);

  const decision = await syncMemoryAssets(input.sync, ports);
  const syncedSha256 = decision.status === "synced" ? decision.verifiedSha256 : null;

  let identityComparison: StageDCanaryReceipt["identityComparison"];
  if (decision.status === "synced") {
    identityComparison = syncedSha256 === input.expectedSha256 ? "match" : "mismatch";
  } else {
    // Not executed against the local destination (denied / planned / replay /
    // recovery-required) — nothing to compare, and production stays legacy-only.
    identityComparison = "not-executed";
  }

  return {
    schema: STAGE_D_CANARY,
    point: input.point,
    businessPhase,
    operationId: input.sync.operationId,
    controlledSyncStatus: decision.status,
    syncedSha256,
    expectedSha256: input.expectedSha256,
    identityComparison,
    quarantine: identityComparison === "mismatch",
    productionWrite: "legacy-only",
    stageDControlledWrite: "shadow-only",
    cloudSyncEnabled: false,
    byosEnabled: false,
    createdAt: now(),
  };
}

/** Persist a canary/mismatch receipt durably under a governed path (auditable).
 * Returns the receipt file path. */
export function writeStageDCanaryReceipt(
  receipt: StageDCanaryReceipt,
  opts: { stateDir?: string } = {},
): string {
  const operationId = assertSafeRecoveryReceiptToken(receipt.operationId, "operationId");
  const root = path.join(
    path.resolve(opts.stateDir ?? resolveStateDir()),
    "data-governance",
    "stage-d-sync",
    "canary",
  );
  fs.mkdirSync(root, { recursive: true });
  const dest = path.join(root, `${receipt.point}-${operationId}.json`);
  const rel = path.relative(root, dest);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("invalid_canary_receipt_path");
  }
  writeJsonDurable(dest, receipt);
  return dest;
}
