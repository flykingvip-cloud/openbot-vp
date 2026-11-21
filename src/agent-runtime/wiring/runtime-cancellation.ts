/** Registrations are made only after trusted lease admission; ingress must authorize session/task. */
const cancellations = new Map<string, Set<() => Promise<boolean>>>();
function key(sessionId: string, taskId: string) {
  return JSON.stringify([sessionId, taskId]);
}
export function registerRuntimeCancellation(
  sessionId: string,
  taskId: string,
  cancel: () => Promise<boolean>,
) {
  const id = key(sessionId, taskId);
  let bucket = cancellations.get(id);
  if (!bucket) {
    bucket = new Set();
    cancellations.set(id, bucket);
  }
  bucket.add(cancel);
  return () => {
    bucket.delete(cancel);
    if (!bucket.size) {
      cancellations.delete(id);
    }
  };
}
export async function cancelAdmittedRuntime(sessionId: string, taskId: string): Promise<void> {
  const callbacks = [...(cancellations.get(key(sessionId, taskId)) ?? [])];
  const results = await Promise.allSettled(callbacks.map((cancel) => cancel()));
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failures.length) {
    throw new AggregateError(
      failures.map((f) => f.reason),
      "Runtime cancellation transaction failed",
    );
  }
}
