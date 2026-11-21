import { withRuntimeDeadline, RUNTIME_SHUTDOWN_MS } from "./deadline.js";
import type { PostgresExecutionRepository } from "./execution.js";

/** Host owns trusted identity; an execution lease never grants tool authorization. */
export async function acquireExecutionLease(params: {
  repository: PostgresExecutionRepository;
  tenantId: string;
  executionId: string;
  owner: string;
  parentSignal?: AbortSignal;
  leaseMs?: number;
}) {
  if (!params.tenantId.trim() || !params.executionId.trim()) {
    throw new Error("Trusted execution identity is required");
  }
  const leaseMs = params.leaseMs ?? 30_000;
  if (!params.owner.trim() || !Number.isSafeInteger(leaseMs) || leaseMs < 3) {
    throw new Error("Invalid execution lease lifecycle options");
  }
  params.parentSignal?.throwIfAborted();
  const claim = await params.repository.claim(
    params.tenantId,
    params.executionId,
    params.owner,
    leaseMs,
  );
  if (!claim) {
    throw new Error("Execution lease unavailable");
  }
  const controller = new AbortController();
  const abort = () => controller.abort(params.parentSignal?.reason);
  if (params.parentSignal?.aborted) {
    abort();
  }
  params.parentSignal?.addEventListener("abort", abort, { once: true });
  let renewing = false;
  let pendingRenewal: Promise<void> = Promise.resolve();
  let stopped = false;
  // A renewal promise may never settle during a network blackhole. Local expiry
  // must still abort tools instead of treating the last successful claim as live.
  let expiresLocallyAt = Date.now() + leaseMs;
  const watchdog = setInterval(
    () => {
      if (!stopped && Date.now() >= expiresLocallyAt) {
        controller.abort(new Error("Execution lease renewal deadline exceeded"));
      }
    },
    Math.max(1, Math.floor(leaseMs / 6)),
  );
  watchdog.unref();
  const timer = setInterval(
    () => {
      if (renewing || stopped || controller.signal.aborted) {
        return;
      }
      renewing = true;
      const renewalStartedAt = Date.now();
      pendingRenewal = params.repository
        .renew({
          tenantId: params.tenantId,
          executionId: params.executionId,
          owner: params.owner,
          fence: String(claim.fence),
          leaseMs,
        })
        .then((ok) => {
          if (!ok) {
            controller.abort(new Error("Execution lease lost"));
          } else if (!controller.signal.aborted) {
            expiresLocallyAt = renewalStartedAt + leaseMs;
          }
        })
        .catch((error) => controller.abort(error))
        .finally(() => {
          renewing = false;
        });
    },
    Math.max(1, Math.floor(leaseMs / 3)),
  );
  timer.unref();
  return {
    signal: controller.signal,
    fence: String(claim.fence),
    version: String(claim.version),
    /** Stop renewal before shutting down the connection pool. Lease expires naturally. */
    dispose() {
      stopped = true;
      clearInterval(timer);
      clearInterval(watchdog);
      params.parentSignal?.removeEventListener("abort", abort);
      controller.abort(new Error("Execution lease disposed"));
      return withRuntimeDeadline(pendingRenewal, RUNTIME_SHUTDOWN_MS, "Lease disposal");
    },
  };
}
