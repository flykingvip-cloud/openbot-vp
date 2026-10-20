import type { IntegrationRunStatus, TenantShard } from "./types.js";

const TERMINAL_RUNS: ReadonlySet<IntegrationRunStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

const TERMINAL_OPS = new Set(["succeeded", "failed", "interrupted"]);

/**
 * Mark work that cannot be resumed. Does not call the device platform and does not
 * replay tool results. In-flight idempotency reservations are dropped, matching
 * cancel, revoke, rebind, and timeout.
 */
export function recoverTenantShard(shard: TenantShard, nowIso: string): TenantShard {
  const next: TenantShard = {
    ...shard,
    associations: { ...shard.associations },
    bindings: { ...shard.bindings },
    operations: { ...shard.operations },
    projections: { ...shard.projections },
    grants: { ...shard.grants },
    runs: { ...shard.runs },
    toolRequests: { ...shard.toolRequests },
    idempotency: {},
    events: [...shard.events],
    bindingHistory: [...shard.bindingHistory],
  };

  for (const [runId, run] of Object.entries(shard.runs)) {
    if (TERMINAL_RUNS.has(run.status)) {
      continue;
    }
    next.runs[runId] = {
      ...run,
      status: "interrupted",
      retryable: false,
      errorCode: "UNKNOWN_AFTER_RESTART",
      finishedAt: nowIso,
    };
  }

  for (const [key, record] of Object.entries(shard.idempotency)) {
    if (record.inflight) {
      continue;
    }
    next.idempotency[key] = record;
  }

  for (const [operationId, operation] of Object.entries(shard.operations)) {
    if (TERMINAL_OPS.has(operation.status)) {
      continue;
    }
    next.operations[operationId] = {
      ...operation,
      status: "interrupted",
      retryable: true,
      progress: "interrupted",
      failure: {
        code: "UNKNOWN_AFTER_RESTART",
        message: "Operation was in flight when the process stopped",
      },
      updatedAt: nowIso,
    };
  }

  for (const [bindingId, binding] of Object.entries(shard.bindings)) {
    if (
      binding.status !== "applying" &&
      binding.status !== "revoking" &&
      binding.status !== "pending_pair" &&
      binding.status !== "pending_auth"
    ) {
      continue;
    }
    next.bindings[bindingId] = {
      ...binding,
      status: "error",
      platformApplied: false,
      failureCode: "UNKNOWN_AFTER_RESTART",
      updatedAt: nowIso,
    };
  }

  for (const [requestId, request] of Object.entries(shard.toolRequests)) {
    if (request.state !== "pending") {
      continue;
    }
    next.toolRequests[requestId] = {
      ...request,
      state: "expired",
      updatedAt: nowIso,
    };
  }

  return next;
}
