/**
 * Worker-facing Account Computer runtime view (v4.1 §9 gates 1–2).
 *
 * The worker consumes an issued snapshot and a billing hold. It does not read
 * billing ledgers, does not deduct, and does not advance snapshot versions.
 * A failed heartbeat sticks: later tool calls must not charge.
 */

export const ACCOUNT_RUNTIME_HEARTBEAT_MAX_SILENCE_MS = 10 * 60 * 1000;

export const ACCOUNT_WORKER_SNAPSHOT_FIELDS = [
  "tenantId",
  "userId",
  "executionId",
  "decisionId",
  "snapshotVersion",
  "authorizationVersion",
  "dataSpaceRef",
  "browserNamespaceRef",
  "modelEntitlement",
  "capabilityDecision",
  "commercialLimits",
  "concurrencyLimits",
  "policyVersion",
  "issuedAt",
  "expiresAt",
  "revoked",
] as const;

export type AccountModelEntitlement = {
  allowlist: string[];
};

export type AccountCapabilityDecision = {
  effect: "allow" | "deny";
};

export type AccountCommercialLimits = {
  creditsRemaining: number;
};

export type AccountConcurrencyLimits = {
  maxConcurrentRuns: number;
  activeCount: number;
};

/** Fields the worker may keep from a control-plane snapshot. */
export type AccountRuntimeSnapshot = {
  tenantId: string;
  userId: string;
  executionId: string;
  decisionId: string;
  snapshotVersion: number;
  /** Audit label for this commercial and permission decision. Not a decision id. */
  authorizationVersion: string;
  dataSpaceRef: string;
  browserNamespaceRef: string;
  modelEntitlement: AccountModelEntitlement;
  capabilityDecision: AccountCapabilityDecision;
  commercialLimits: AccountCommercialLimits;
  concurrencyLimits: AccountConcurrencyLimits;
  policyVersion: string;
  issuedAt: string;
  expiresAt: string;
  revoked: boolean;
};

export type AccountWorkerLimits = {
  creditsRemaining: number;
  maxConcurrentRuns: number;
};

export type AccountWorkerLease = {
  runtimeLeaseId: string;
  expiresAt: string;
  revoked: boolean;
  snapshotVersion: number;
};

/** The only billing facts a worker holds: allow / limits / decisionId / lease. */
export type AccountWorkerBillingHold = {
  allow: boolean;
  limits: AccountWorkerLimits;
  decisionId: string;
  lease: AccountWorkerLease;
};

export type ControlPlaneHeartbeatAnswer = {
  decisionValid: boolean;
  currentSnapshotVersion: number;
  leaseRevoked: boolean;
  leaseExpiresAt: string;
  quotaAllowed: boolean;
  concurrencyAllowed: boolean;
  checkedAt: string;
  runtimeLeaseId: string;
};

export type WorkerHeartbeatReason =
  | "ok"
  | "not-allowed"
  | "stale-snapshot"
  | "revoked"
  | "lease-expired"
  | "lease-mismatch"
  | "decision-invalid"
  | "quota"
  | "concurrency"
  | "heartbeat-stale"
  | "missing-snapshot";

export type WorkerHeartbeatVerdict = {
  continueBilling: boolean;
  reason: WorkerHeartbeatReason;
};

export function toWorkerRuntimeSnapshot(snapshot: AccountRuntimeSnapshot): AccountRuntimeSnapshot {
  return {
    tenantId: snapshot.tenantId,
    userId: snapshot.userId,
    executionId: snapshot.executionId,
    decisionId: snapshot.decisionId,
    snapshotVersion: snapshot.snapshotVersion,
    authorizationVersion: snapshot.authorizationVersion,
    dataSpaceRef: snapshot.dataSpaceRef,
    browserNamespaceRef: snapshot.browserNamespaceRef,
    modelEntitlement: { allowlist: [...snapshot.modelEntitlement.allowlist] },
    capabilityDecision: { effect: snapshot.capabilityDecision.effect },
    commercialLimits: { creditsRemaining: snapshot.commercialLimits.creditsRemaining },
    concurrencyLimits: {
      maxConcurrentRuns: snapshot.concurrencyLimits.maxConcurrentRuns,
      activeCount: snapshot.concurrencyLimits.activeCount,
    },
    policyVersion: snapshot.policyVersion,
    issuedAt: snapshot.issuedAt,
    expiresAt: snapshot.expiresAt,
    revoked: snapshot.revoked,
  };
}

export function projectWorkerBillingHold(params: {
  snapshot: AccountRuntimeSnapshot;
  lease: AccountWorkerLease;
}): AccountWorkerBillingHold {
  return {
    allow: params.snapshot.capabilityDecision.effect === "allow" && !params.snapshot.revoked,
    limits: {
      creditsRemaining: params.snapshot.commercialLimits.creditsRemaining,
      maxConcurrentRuns: params.snapshot.concurrencyLimits.maxConcurrentRuns,
    },
    decisionId: params.snapshot.decisionId,
    lease: {
      runtimeLeaseId: params.lease.runtimeLeaseId,
      expiresAt: params.lease.expiresAt,
      revoked: params.lease.revoked || params.snapshot.revoked,
      snapshotVersion: params.lease.snapshotVersion,
    },
  };
}

function stop(reason: WorkerHeartbeatReason): WorkerHeartbeatVerdict {
  return { continueBilling: false, reason };
}

/**
 * Lightweight tool-call check. Compares the hold the worker already has with
 * the control plane's answer. It does not recompute policy or read a ledger.
 */
export function evaluateAccountWorkerHeartbeat(params: {
  hold: AccountWorkerBillingHold;
  answer: ControlPlaneHeartbeatAnswer;
  nowMs: number;
  maxSilenceMs?: number;
}): WorkerHeartbeatVerdict {
  const maxSilence = params.maxSilenceMs ?? ACCOUNT_RUNTIME_HEARTBEAT_MAX_SILENCE_MS;
  const { hold, answer } = params;
  if (answer.leaseRevoked || hold.lease.revoked) {
    return stop("revoked");
  }
  if (hold.lease.snapshotVersion !== answer.currentSnapshotVersion) {
    return stop("stale-snapshot");
  }
  if (hold.lease.runtimeLeaseId !== answer.runtimeLeaseId) {
    return stop("lease-mismatch");
  }
  if (!answer.decisionValid || hold.decisionId.trim() === "") {
    return stop("decision-invalid");
  }
  const expiresAt = Date.parse(answer.leaseExpiresAt);
  if (!Number.isFinite(expiresAt) || params.nowMs >= expiresAt) {
    return stop("lease-expired");
  }
  if (!hold.allow) {
    return stop("not-allowed");
  }
  if (!answer.quotaAllowed) {
    return stop("quota");
  }
  if (!answer.concurrencyAllowed) {
    return stop("concurrency");
  }
  const checkedAt = Date.parse(answer.checkedAt);
  if (!Number.isFinite(checkedAt) || params.nowMs - checkedAt > maxSilence) {
    return stop("heartbeat-stale");
  }
  return { continueBilling: true, reason: "ok" };
}

/**
 * Heartbeat stop reasons that mean in-flight account-worker work did not finish a durable
 * workspace write. Declared 「打开成果」 chips for files never written must not stay openable
 * (UI clears them after a confirmed preview miss; see applyUnavailableFilePreview).
 */
export function isNonDurableAccountWorkerStop(reason: WorkerHeartbeatReason): boolean {
  return (
    reason === "stale-snapshot" ||
    reason === "revoked" ||
    reason === "lease-expired" ||
    reason === "lease-mismatch" ||
    reason === "not-allowed" ||
    reason === "missing-snapshot"
  );
}

/**
 * Once a heartbeat says stop, this gate stays closed for the rest of the
 * session. A later ok answer does not reopen charging.
 */
export class AccountWorkerChargeGate {
  private stopped = false;

  constructor(private readonly hold: AccountWorkerBillingHold) {}

  note(verdict: WorkerHeartbeatVerdict): void {
    if (!verdict.continueBilling) {
      this.stopped = true;
    }
  }

  mayCharge(): boolean {
    return this.hold.allow && !this.stopped && !this.hold.lease.revoked;
  }
}
