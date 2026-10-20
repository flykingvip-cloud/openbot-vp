/**
 * CQ-O1a search/manual sync operation boundary.
 *
 * acquireSyncAuth is the only construction entry that may let search trigger op=sync.
 * Search must not import createV1OperationAuth or begin rebuild/reset/prune.
 * Does not write fingerprints, create the primary sqlite, or apply env grants on reason=search.
 */
import {
  createV1OperationAuth,
  decideV1RootGuard,
  isV1OperationAuthExpired,
  normalizeRootFingerprint,
  normalizeSqliteInstanceId,
  type V1MaintenanceUnlock,
  type V1OperationAuth,
  type V1RootGuardDecision,
} from "./v1-root-guard.js";

export const SEARCH_SYNC_AUTH_TTL_MS = 15_000;

export type AcquireSyncAuthReasonCode =
  | "destructive.denied"
  | "destructive.grant-required"
  | "authority.unknown"
  | "topology.multiple"
  | "auth.expired"
  | "auth.mismatch";

export type AcquireSyncAuthRequest = {
  op: "sync";
  reason: "search" | "manual";
  agentId: string;
  sqliteInstanceId: string;
  workspaceFingerprint: string;
};

export type AcquireSyncAuthResult =
  | {
      ok: true;
      auth: V1OperationAuth;
      expiresAt: string;
      holder: "single-flight";
    }
  | {
      ok: false;
      reasonCode: AcquireSyncAuthReasonCode;
      reason: string;
    };

export type AcquireSyncAuthDeps = {
  sqlitePath: string;
  workspaceDir: string;
  recordedFingerprints: string[];
  sqliteExists: boolean;
  knownConflict?: boolean;
  nowMs?: number;
  timeoutMs?: number;
  /** Manual path only. Search must omit this so env grants cannot silently allow search-sync. */
  unlock?: V1MaintenanceUnlock;
};

const searchSyncFlights = new Map<string, Promise<void>>();

export function searchOptsRequestForbiddenDestructive(opts?: {
  force?: unknown;
  rebuild?: unknown;
  reset?: unknown;
}): boolean {
  if (!opts) {
    return false;
  }
  return "force" in opts || "rebuild" in opts || "reset" in opts;
}

export function searchSyncFlightKey(agentId: string, sqliteInstanceId: string): string {
  return `${agentId}\n${sqliteInstanceId}`;
}

export function resetSearchSyncFlightsForTests(): void {
  searchSyncFlights.clear();
}

/**
 * Single-flight for (agentId, sqliteInstanceId). Sets the slot before `start` runs
 * so a concurrent follower cannot acquire a second auth.
 */
export function beginSearchSyncFlight(
  key: string,
  start: () => Promise<void>,
): { leader: boolean; flight: Promise<void> } {
  const existing = searchSyncFlights.get(key);
  if (existing) {
    return { leader: false, flight: existing };
  }
  let settle!: () => void;
  const holder = new Promise<void>((resolve) => {
    settle = resolve;
  });
  searchSyncFlights.set(key, holder);
  let work: Promise<void>;
  try {
    work = start();
  } catch (error) {
    searchSyncFlights.delete(key);
    settle();
    throw error;
  }
  const flight = work.finally(() => {
    searchSyncFlights.delete(key);
    settle();
  });
  searchSyncFlights.set(key, flight);
  return { leader: true, flight };
}

export function validateAcquireSyncAuth(
  result: AcquireSyncAuthResult,
  nowMs: number = Date.now(),
): AcquireSyncAuthResult {
  if (!result.ok) {
    return result;
  }
  if (isV1OperationAuthExpired(result.auth, nowMs) || Date.parse(result.expiresAt) <= nowMs) {
    return {
      ok: false,
      reasonCode: "auth.expired",
      reason: "search-sync-auth-expired",
    };
  }
  return result;
}

export function mapV1GuardRefuseToAcquireReason(
  decision: V1RootGuardDecision,
  params: { unlockAttempted: boolean },
): { reasonCode: AcquireSyncAuthReasonCode; reason: string } {
  const reason = decision.reason ?? "v1-root-guard-refused";
  if (reason === "unregistered-v1-fail-closed") {
    return { reasonCode: "authority.unknown", reason };
  }
  if (reason === "v1-multi-root-or-root-mismatch") {
    if (decision.recordedFingerprints.length > 1) {
      return { reasonCode: "topology.multiple", reason };
    }
    return { reasonCode: "destructive.denied", reason };
  }
  if (reason === "known-conflict-preset-deny") {
    return { reasonCode: "destructive.grant-required", reason };
  }
  if (params.unlockAttempted) {
    return { reasonCode: "destructive.grant-required", reason };
  }
  return { reasonCode: "destructive.denied", reason };
}

export function acquireSyncAuth(
  request: AcquireSyncAuthRequest,
  deps: AcquireSyncAuthDeps,
): AcquireSyncAuthResult {
  if (request.op !== "sync") {
    return {
      ok: false,
      reasonCode: "auth.mismatch",
      reason: "acquire-sync-auth-op-must-be-sync",
    };
  }
  if (!request.agentId.trim()) {
    return {
      ok: false,
      reasonCode: "auth.mismatch",
      reason: "acquire-sync-auth-agent-required",
    };
  }
  if (!deps.sqliteExists) {
    return {
      ok: false,
      reasonCode: "authority.unknown",
      reason: "search-sync-sqlite-missing",
    };
  }

  const sqliteInstanceId = normalizeSqliteInstanceId(deps.sqlitePath);
  const workspaceFingerprint = normalizeRootFingerprint(deps.workspaceDir);
  if (sqliteInstanceId !== request.sqliteInstanceId) {
    return {
      ok: false,
      reasonCode: "auth.mismatch",
      reason: "search-sync-sqlite-instance-mismatch",
    };
  }
  if (workspaceFingerprint !== request.workspaceFingerprint) {
    return {
      ok: false,
      reasonCode: "auth.mismatch",
      reason: "search-sync-workspace-fingerprint-mismatch",
    };
  }

  const nowMs = deps.nowMs ?? Date.now();
  const timeoutMs = Math.min(deps.timeoutMs ?? SEARCH_SYNC_AUTH_TTL_MS, SEARCH_SYNC_AUTH_TTL_MS);
  const unlockAttempted = Boolean(deps.unlock);
  // Search never consumes env grants; only explicit manual unlock may be evaluated.
  const unlock = request.reason === "manual" ? deps.unlock : undefined;

  const decision = decideV1RootGuard({
    op: "sync",
    incomingFingerprint: workspaceFingerprint,
    recordedFingerprints: deps.recordedFingerprints,
    sqlitePath: deps.sqlitePath,
    knownConflict: deps.knownConflict,
    unlock,
    now: nowMs,
  });

  if (!decision.allow) {
    return {
      ok: false,
      ...mapV1GuardRefuseToAcquireReason(decision, { unlockAttempted }),
    };
  }

  const expiresAtMs = nowMs + timeoutMs;
  return {
    ok: true,
    auth: createV1OperationAuth("sync", deps.sqlitePath, { expiresAtMs }),
    expiresAt: new Date(expiresAtMs).toISOString(),
    holder: "single-flight",
  };
}
