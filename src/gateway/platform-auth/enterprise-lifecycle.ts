/**
 * Trial lifecycle transitions for platform-auth enterprises.
 *
 * Single source of truth for what happens when a trial tenant reaches
 * `trialEndsAt`, applying the platform / per-tenant trial-expiry handling
 * policy. Kept as a leaf module (depends only on store-types) so both the
 * store loader and the auth helpers can share one implementation without an
 * import cycle.
 */

import type {
  PlatformAuthEnterprise,
  PlatformAuthStore,
  PlatformAuthTrialExpiryHandling,
} from "./store-types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Effective trial-expiry handling for a tenant: the per-tenant override wins,
 * then the platform default, then a hard auto-stop.
 */
export function resolveTrialExpiryHandling(
  store: PlatformAuthStore,
  enterprise: PlatformAuthEnterprise,
): PlatformAuthTrialExpiryHandling {
  return enterprise.expiryHandling ?? store.policy?.trialExpiryHandling ?? "auto_stop";
}

/**
 * Advance trial tenants past `trialEndsAt` according to the resolved expiry
 * handling. Returns true when any enterprise changed.
 *
 * - `grace_period` (graceDays > 0): keep full trial access until
 *   `trialEndsAt + graceDays`, recording `graceEndsAt`; hard-expire afterwards.
 * - `read_only`: expire and allow read-only access (`allowReadOnlyAfterExpiry = true`).
 * - `auto_stop` (default): expire and hard-stop (`allowReadOnlyAfterExpiry = false`).
 *
 * On expiry we stamp `expiredHandledAt` and clear any `graceEndsAt`.
 */
export function refreshEnterpriseStatuses(store: PlatformAuthStore, now = Date.now()): boolean {
  let changed = false;
  const nowIso = new Date(now).toISOString();
  const graceDays = Math.max(0, Math.floor(store.policy?.trialGraceDays ?? 0));
  for (const enterprise of Object.values(store.enterprises)) {
    if (enterprise.status !== "trial" || !enterprise.trialEndsAt) {
      continue;
    }
    const trialEndsAtMs = Number(new Date(enterprise.trialEndsAt));
    if (!Number.isFinite(trialEndsAtMs) || trialEndsAtMs > now) {
      continue;
    }
    const handling = resolveTrialExpiryHandling(store, enterprise);
    if (handling === "grace_period" && graceDays > 0) {
      const graceEndsAtMs = trialEndsAtMs + graceDays * DAY_MS;
      if (graceEndsAtMs > now) {
        // Still within the grace window: keep full trial access, just record the deadline.
        const graceEndsAtIso = new Date(graceEndsAtMs).toISOString();
        if (enterprise.graceEndsAt !== graceEndsAtIso) {
          enterprise.graceEndsAt = graceEndsAtIso;
          enterprise.updatedAt = nowIso;
          changed = true;
        }
        continue;
      }
    }
    enterprise.status = "expired";
    enterprise.trialExpiredAt = enterprise.trialExpiredAt ?? nowIso;
    enterprise.allowReadOnlyAfterExpiry = handling === "read_only";
    enterprise.expiredHandledAt = nowIso;
    if (enterprise.graceEndsAt !== undefined) {
      enterprise.graceEndsAt = undefined;
    }
    enterprise.updatedAt = nowIso;
    changed = true;
  }
  return changed;
}
