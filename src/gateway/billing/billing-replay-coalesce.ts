/**
 * During one replayPending pass, every usage event used to recompute the
 * enterprise snapshot from the full usage JSON. Keep a single in-flight
 * recompute per enterprise until that replay finishes.
 */

let replayDepth = 0;
const replaySnapshotByEnterprise = new Map<string, Promise<unknown>>();

export function enterBillingReplay(): void {
  replayDepth += 1;
}

export function leaveBillingReplay(): void {
  replayDepth -= 1;
  if (replayDepth <= 0) {
    replayDepth = 0;
    replaySnapshotByEnterprise.clear();
  }
}

export function isBillingReplayActive(): boolean {
  return replayDepth > 0;
}

export function replaySnapshot<T>(enterpriseId: string, run: () => Promise<T>): Promise<T> {
  if (replayDepth <= 0) {
    return run();
  }
  const existing = replaySnapshotByEnterprise.get(enterpriseId);
  if (existing) {
    return existing as Promise<T>;
  }
  const promise = run();
  replaySnapshotByEnterprise.set(enterpriseId, promise);
  return promise;
}
