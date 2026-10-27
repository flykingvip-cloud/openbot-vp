/**
 * askOutcome W1: scheduler-owned cron fire identity.
 * Allocate once per schedule fire; reuse on same-fire retry / restart recovery.
 */
export type CronFireIdState = {
  currentFireId?: string;
};

export function resolveOrAllocateCronFireId(
  state: CronFireIdState,
  params: { jobId: string; startedAtMs: number },
): string {
  const existing = state.currentFireId?.trim();
  if (existing) {
    return existing;
  }
  const jobId = params.jobId.trim() || "job";
  const fireId = `${jobId}:${params.startedAtMs}`;
  state.currentFireId = fireId;
  return fireId;
}

/**
 * Retain fire id only when the scheduler is retrying the *same* fire
 * (transient / error backoff). Clear when the fire completed so the next
 * schedule allocates a new identity.
 */
export function shouldRetainCronFireId(params: {
  status: string;
  completionHold: boolean;
  jobStillEnabled: boolean;
  hasNextRunAtMs: boolean;
  retainedBecauseErrorRetry: boolean;
}): boolean {
  if (params.completionHold) {
    return false;
  }
  return params.retainedBecauseErrorRetry;
}
