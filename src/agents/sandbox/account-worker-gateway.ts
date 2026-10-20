/**
 * Gateway-side switch for the account Worker prototype (v4.1 §10).
 *
 * P6b: OPENBOT_ACCOUNT_WORKER defaults ON when unset (explicit 0/false/off to
 * roll back). personal_local is never forced onto this path — enablement still
 * requires managed_enterprise + shared tenant addressing. The only body the
 * Gateway may forward is a lease id plus the trusted scope. Image, mounts,
 * env, volumes, hostPath, and docker settings are rejected by the controller
 * parser before a worker is constructed.
 * This module does not import the docker CLI. Container specs are built inside
 * the worker from the lease.
 */
import { isSharedTenantAddressingEnabled } from "../../config/data-space.js";
import type { OpenBotConfig } from "../../config/types.js";
import type { AccountRuntimeSnapshotStore } from "../../gateway/governance/account-runtime-snapshot.js";
import { resolveSecurityProfile } from "../../gateway/security-profile.js";
import { isAccountWorkerFlagOn, type AccountWorkerControlPlane } from "./account-worker.js";

/** Align with embedded prototype lease window (12h). */
export const ACCOUNT_WORKER_RUNTIME_LEASE_TTL_MS = 12 * 60 * 60 * 1000;

export function isAccountWorkerPrototypeEnabled(
  cfg: OpenBotConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isAccountWorkerFlagOn(env)) {
    return false;
  }
  if (!isSharedTenantAddressingEnabled(cfg, env)) {
    return false;
  }
  const profile = resolveSecurityProfile(cfg, env);
  return profile.profile === "managed_enterprise";
}

/**
 * Bind a worker to the control-plane snapshot store.
 * Quota and concurrency answers come from the issued snapshot, not from a
 * ledger the worker opens itself.
 */
export function createAccountWorkerControlPlane(
  store: AccountRuntimeSnapshotStore,
): AccountWorkerControlPlane {
  return {
    findByLease(runtimeLeaseId) {
      return store.findByLease(runtimeLeaseId);
    },
    async heartbeat(params) {
      const head = await store.findByLease(params.runtimeLeaseId);
      const credits = head?.snapshot.commercialLimits.creditsRemaining ?? 0;
      const concurrency = head?.snapshot.concurrencyLimits;
      const quotaAllowed =
        head != null &&
        head.snapshot.capabilityDecision.effect === "allow" &&
        !head.snapshot.revoked &&
        credits > 0;
      const concurrencyAllowed = Boolean(
        concurrency && concurrency.activeCount <= concurrency.maxConcurrentRuns,
      );
      let verdict = await store.heartbeat({
        ...params,
        quotaAllowed,
        concurrencyAllowed,
      });
      // Runtime lease TTL is not the enterprise tenant subscription. When the
      // tenant is still entitled, soft-renew the same lease id instead of
      // failing the turn with lease-expired.
      if (verdict.reason === "lease-expired" && quotaAllowed) {
        const extended = await store.extendLeaseIfStillEntitled({
          runtimeLeaseId: params.runtimeLeaseId,
          nowMs: params.nowMs,
          ttlMs: ACCOUNT_WORKER_RUNTIME_LEASE_TTL_MS,
        });
        if (extended) {
          verdict = await store.heartbeat({
            ...params,
            quotaAllowed,
            concurrencyAllowed,
          });
        }
      }
      return verdict;
    },
  };
}
