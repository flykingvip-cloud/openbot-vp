/**
 * Cross-process worker fixture for the Stage D persistent fencing store.
 * Run via: node --import tsx stage-d-fence-worker.ts <stateDir> <fenceKey> <operationId> <token> [action]
 * action = acquire (default) | complete | recover. Prints a single JSON summary line.
 * NOT a test file (no `.test.` suffix), so vitest does not collect it.
 */
import { createPersistentStageDStore } from "../item7-stage-d-persistent-store.js";

function main(): void {
  const [stateDir, fenceKey, operationId, token, action = "acquire"] = process.argv.slice(2);
  if (!stateDir || !fenceKey || !operationId || !token) {
    process.stdout.write(`${JSON.stringify({ error: "missing_args" })}\n`);
    process.exit(1);
  }
  const store = createPersistentStageDStore({ stateDir });
  const resource = fenceKey.startsWith("memory-sync:")
    ? fenceKey.slice("memory-sync:".length)
    : fenceKey;

  if (action === "complete") {
    const acq = store.tryAcquire(fenceKey, operationId, token);
    if (acq.acquired) {
      store.markCompleted({
        operationId,
        tenantId: "tenant-a",
        sourceResourceId: resource,
        destinationMode: "local-only",
        manifestSha256: "c".repeat(64),
        classification: "confidential",
      });
    }
    process.stdout.write(`${JSON.stringify({ action, acquired: acq.acquired })}\n`);
    return;
  }

  if (action === "recover") {
    store.tryAcquire(fenceKey, operationId, token);
    store.recordRecoveryRequired({
      operationId,
      tenantId: "tenant-a",
      resourceIds: [resource],
      fenceKey,
      reason: "partial_copy_failure",
      adapterResult: "partial-failure",
    });
    process.stdout.write(
      `${JSON.stringify({ action, blocked: store.isRecoveryBlocked(fenceKey) })}\n`,
    );
    return;
  }

  // Default: acquire and print the outcome; the winner holds (does not release).
  process.stdout.write(`${JSON.stringify(store.tryAcquire(fenceKey, operationId, token))}\n`);
}

main();
