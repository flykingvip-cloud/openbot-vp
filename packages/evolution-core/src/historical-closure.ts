/**
 * Official disposition of the full-history Capsule closure gap.
 *
 * Eligible-data closure passed. Full-history closure did not, and must not be
 * "fixed" by migrating, inferring, or backfilling legacy failureClusterRef.
 */
export const HISTORICAL_CAPSULE_CLOSURE_DISPOSITION = {
  completionStatus: "not_achieved",
  disposition: "accepted_permanent_exclusion",
  reasonCode: "legacy_missing_failure_cluster",
  recoverable: false,
  blocksEligibleDataRelease: false,
  blocksFullHistoryClosureClaim: true,
  forbiddenRemediations: ["migrate", "infer", "backfill", "rewrite_unavailable_to_eligible"],
} as const;

export type HistoricalCapsuleClosureDisposition = typeof HISTORICAL_CAPSULE_CLOSURE_DISPOSITION;

export function historicalCapsuleClosureIsRecoverable(): false {
  return HISTORICAL_CAPSULE_CLOSURE_DISPOSITION.recoverable;
}

export function mayClaimFullHistoryEvolutionClosure(): false {
  return !HISTORICAL_CAPSULE_CLOSURE_DISPOSITION.blocksFullHistoryClosureClaim;
}
