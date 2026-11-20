/** Gateway-scoped ownership of deferred execution resources. */
const leases = new Set<() => Promise<void>>();
let stopping = false;
export function registerRuntimeLease(cleanup: () => Promise<void>): () => void {
  if (stopping) {
    throw new Error("Gateway is stopping; execution admission closed");
  }
  leases.add(cleanup);
  return () => {
    leases.delete(cleanup);
  };
}
export async function stopRuntimeLeases(): Promise<void> {
  stopping = true;
  const results = await Promise.allSettled([...leases].map((cleanup) => cleanup()));
  const errors = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (errors.length) {
    throw new AggregateError(
      errors.map((result) => result.reason),
      "Runtime lease cleanup failed",
    );
  }
}
/** Gateway startup explicitly reopens admission after a prior in-process shutdown. */
export function startRuntimeLeaseAdmission(): void {
  if (leases.size) {
    throw new Error("Previous runtime leases are not drained");
  }
  stopping = false;
}
