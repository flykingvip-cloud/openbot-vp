// Keep overload pacing noticeable enough to avoid tight retry bursts, but short
// enough that fallback still feels responsive within a single turn.
export const OVERLOAD_FAILOVER_BACKOFF_POLICY = {
  initialMs: 250,
  maxMs: 1_500,
  factor: 2,
  jitter: 0.2,
};

export const MAX_OVERFLOW_COMPACTION_ATTEMPTS = 3;
// Defensive guard for the outer run loop across all retry branches.
const BASE_RUN_RETRY_ITERATIONS = 24;
const RUN_RETRY_ITERATIONS_PER_PROFILE = 8;
const MIN_RUN_RETRY_ITERATIONS = 32;
const MAX_RUN_RETRY_ITERATIONS = 160;

export function resolveMaxRunRetryIterations(profileCandidateCount: number): number {
  const scaled =
    BASE_RUN_RETRY_ITERATIONS +
    Math.max(1, profileCandidateCount) * RUN_RETRY_ITERATIONS_PER_PROFILE;
  return Math.min(MAX_RUN_RETRY_ITERATIONS, Math.max(MIN_RUN_RETRY_ITERATIONS, scaled));
}
