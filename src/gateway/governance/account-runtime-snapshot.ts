/**
 * Control-plane Account Computer runtime snapshots (v4.1 §9 gate 1).
 *
 * Issued at turn start. `snapshotVersion` only moves forward. A late older
 * snapshot cannot replace the head. Revoke and reissue mint a higher version.
 * The worker never supplies the version or the lease id.
 */

import { randomUUID } from "node:crypto";
import { readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import {
  evaluateAccountWorkerHeartbeat,
  projectWorkerBillingHold,
  toWorkerRuntimeSnapshot,
  type AccountCapabilityDecision,
  type AccountCommercialLimits,
  type AccountConcurrencyLimits,
  type AccountModelEntitlement,
  type AccountRuntimeSnapshot,
  type AccountWorkerBillingHold,
  type AccountWorkerLease,
  type ControlPlaneHeartbeatAnswer,
  type WorkerHeartbeatVerdict,
} from "./account-worker-runtime.js";
import { isGovernanceDecisionId } from "./decision-id.js";

export type AccountRuntimeLease = {
  runtimeLeaseId: string;
  tenantId: string;
  userId: string;
  agentId: string;
  executionId: string;
  decisionId: string;
  snapshotVersion: number;
  expiresAt: string;
  revoked: boolean;
};

export type IssueAccountRuntimeSnapshotInput = {
  tenantId: string;
  userId: string;
  agentId: string;
  executionId: string;
  decisionId: string;
  authorizationVersion: string;
  dataSpaceRef: string;
  collaborationGroupId?: string;
  browserNamespaceRef: string;
  modelEntitlement: AccountModelEntitlement;
  capabilityDecision: AccountCapabilityDecision;
  commercialLimits: AccountCommercialLimits;
  concurrencyLimits: AccountConcurrencyLimits;
  policyVersion: string;
  issuedAt: string;
  expiresAt: string;
};

export type IssuedAccountRuntime = {
  snapshot: AccountRuntimeSnapshot;
  lease: AccountRuntimeLease;
  workerSnapshot: AccountRuntimeSnapshot;
  hold: AccountWorkerBillingHold;
};

type Head = {
  snapshot: AccountRuntimeSnapshot;
  lease: AccountRuntimeLease;
};

type SnapshotFile = {
  version: 1;
  heads: Record<string, Head>;
};

const emptyFile = (): SnapshotFile => ({ version: 1, heads: {} });

function requireText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  return trimmed;
}

function requireTime(value: string, label: string): string {
  const trimmed = requireText(value, label);
  if (!Number.isFinite(Date.parse(trimmed))) {
    throw new Error(`${label} must be a timestamp`);
  }
  return trimmed;
}

function headKey(tenantId: string, userId: string, executionId: string): string {
  return JSON.stringify([tenantId, userId, executionId]);
}

function sameSnapshot(left: AccountRuntimeSnapshot, right: AccountRuntimeSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class AccountRuntimeSnapshotStore {
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly createLeaseId: () => string = () => `lease-${randomUUID()}`,
  ) {}

  private lock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async read(): Promise<SnapshotFile> {
    const parsed = await readJsonFile<SnapshotFile>(this.filePath);
    if (!parsed) {
      return emptyFile();
    }
    if (parsed.version !== 1 || !parsed.heads || typeof parsed.heads !== "object") {
      throw new Error(`runtime snapshot store is unreadable: ${this.filePath}`);
    }
    return parsed;
  }

  private async write(file: SnapshotFile): Promise<void> {
    await writeJsonAtomic(this.filePath, file);
  }

  /** Control-plane lookup by the lease it issued. Workers do not mint lease ids. */
  async findByLease(runtimeLeaseId: string): Promise<Head | null> {
    const id = runtimeLeaseId.trim();
    if (!id) {
      return null;
    }
    const file = await this.read();
    for (const head of Object.values(file.heads)) {
      if (head.lease.runtimeLeaseId === id) {
        return head;
      }
    }
    return null;
  }

  async current(params: {
    tenantId: string;
    userId: string;
    executionId: string;
  }): Promise<Head | null> {
    const file = await this.read();
    return (
      file.heads[
        headKey(
          requireText(params.tenantId, "tenantId"),
          requireText(params.userId, "userId"),
          requireText(params.executionId, "executionId"),
        )
      ] ?? null
    );
  }

  async issue(input: IssueAccountRuntimeSnapshotInput): Promise<IssuedAccountRuntime> {
    return this.lock(async () => {
      await Promise.resolve();
      const tenantId = requireText(input.tenantId, "tenantId");
      const userId = requireText(input.userId, "userId");
      const executionId = requireText(input.executionId, "executionId");
      const decisionId = requireText(input.decisionId, "decisionId");
      if (!isGovernanceDecisionId(decisionId)) {
        throw new Error("decisionId must be a gd- governance decision id");
      }
      const authorizationVersion = requireText(input.authorizationVersion, "authorizationVersion");
      if (authorizationVersion === decisionId) {
        throw new Error("authorizationVersion is an audit label, not a decision id");
      }
      const issuedAt = requireTime(input.issuedAt, "issuedAt");
      const expiresAt = requireTime(input.expiresAt, "expiresAt");
      if (Date.parse(expiresAt) <= Date.parse(issuedAt)) {
        throw new Error("expiresAt must be after issuedAt");
      }
      const allowlist = input.modelEntitlement?.allowlist;
      if (!Array.isArray(allowlist) || allowlist.some((entry) => typeof entry !== "string")) {
        throw new Error("modelEntitlement.allowlist must be a string list");
      }
      const effect = input.capabilityDecision?.effect;
      if (effect !== "allow" && effect !== "deny") {
        throw new Error("capabilityDecision.effect must be allow or deny");
      }
      const creditsRemaining = input.commercialLimits?.creditsRemaining;
      const maxConcurrentRuns = input.concurrencyLimits?.maxConcurrentRuns;
      const activeCount = input.concurrencyLimits?.activeCount;
      if (!Number.isFinite(creditsRemaining) || creditsRemaining < 0) {
        throw new Error("commercialLimits.creditsRemaining must be a non-negative number");
      }
      if (!Number.isInteger(maxConcurrentRuns) || maxConcurrentRuns < 0) {
        throw new Error("concurrencyLimits.maxConcurrentRuns must be a non-negative integer");
      }
      if (!Number.isInteger(activeCount) || activeCount < 0) {
        throw new Error("concurrencyLimits.activeCount must be a non-negative integer");
      }

      const file = await this.read();
      const key = headKey(tenantId, userId, executionId);
      const previous = file.heads[key];
      const snapshotVersion = (previous?.snapshot.snapshotVersion ?? 0) + 1;
      const snapshot: AccountRuntimeSnapshot = {
        tenantId,
        userId,
        executionId,
        decisionId,
        snapshotVersion,
        authorizationVersion,
        dataSpaceRef: requireText(input.dataSpaceRef, "dataSpaceRef"),
        ...(input.collaborationGroupId
          ? {
              collaborationGroupId: requireText(input.collaborationGroupId, "collaborationGroupId"),
            }
          : {}),
        browserNamespaceRef: requireText(input.browserNamespaceRef, "browserNamespaceRef"),
        modelEntitlement: { allowlist: [...allowlist] },
        capabilityDecision: { effect },
        commercialLimits: { creditsRemaining },
        concurrencyLimits: { maxConcurrentRuns, activeCount },
        policyVersion: requireText(input.policyVersion, "policyVersion"),
        issuedAt,
        expiresAt,
        revoked: false,
      };
      const lease: AccountRuntimeLease = {
        runtimeLeaseId: this.createLeaseId(),
        tenantId,
        userId,
        agentId: requireText(input.agentId, "agentId"),
        executionId,
        decisionId,
        snapshotVersion,
        expiresAt,
        revoked: false,
      };
      file.heads[key] = { snapshot, lease };
      await this.write(file);
      return this.present(snapshot, lease);
    });
  }

  async revoke(params: {
    tenantId: string;
    userId: string;
    executionId: string;
    nowIso: string;
  }): Promise<IssuedAccountRuntime> {
    return this.lock(async () => {
      const tenantId = requireText(params.tenantId, "tenantId");
      const userId = requireText(params.userId, "userId");
      const executionId = requireText(params.executionId, "executionId");
      const nowIso = requireTime(params.nowIso, "nowIso");
      const file = await this.read();
      const key = headKey(tenantId, userId, executionId);
      const previous = file.heads[key];
      if (!previous) {
        throw new Error("cannot revoke an unknown runtime snapshot");
      }
      const snapshot: AccountRuntimeSnapshot = {
        ...toWorkerRuntimeSnapshot(previous.snapshot),
        snapshotVersion: previous.snapshot.snapshotVersion + 1,
        issuedAt: nowIso,
        revoked: true,
      };
      const lease: AccountRuntimeLease = {
        ...previous.lease,
        snapshotVersion: snapshot.snapshotVersion,
        revoked: true,
      };
      file.heads[key] = { snapshot, lease };
      await this.write(file);
      return this.present(snapshot, lease);
    });
  }

  /**
   * A snapshot that arrives after a newer head. Older and unissued versions
   * are ignored. The current head is left as it is.
   */
  async observeLate(snapshot: AccountRuntimeSnapshot): Promise<"current" | "stale" | "rejected"> {
    return this.lock(async () => {
      const file = await this.read();
      const key = headKey(snapshot.tenantId, snapshot.userId, snapshot.executionId);
      const head = file.heads[key];
      if (!head) {
        return "rejected";
      }
      if (snapshot.snapshotVersion < head.snapshot.snapshotVersion) {
        return "stale";
      }
      if (
        snapshot.snapshotVersion === head.snapshot.snapshotVersion &&
        sameSnapshot(snapshot, head.snapshot)
      ) {
        return "current";
      }
      return "rejected";
    });
  }

  /**
   * Soft-renew a runtime lease when the tenant is still allowed to run.
   * Keeps the same runtimeLeaseId so in-flight workers do not see lease-mismatch.
   * Returns null when the lease is missing, revoked, or capability is deny.
   */
  async extendLeaseIfStillEntitled(params: {
    runtimeLeaseId: string;
    nowMs: number;
    ttlMs: number;
  }): Promise<AccountRuntimeLease | null> {
    return this.lock(async () => {
      const id = params.runtimeLeaseId.trim();
      if (!id) {
        return null;
      }
      const file = await this.read();
      for (const key of Object.keys(file.heads)) {
        const head = file.heads[key];
        if (head.lease.runtimeLeaseId !== id) {
          continue;
        }
        if (head.lease.revoked || head.snapshot.revoked) {
          return null;
        }
        if (head.snapshot.capabilityDecision.effect !== "allow") {
          return null;
        }
        const ttlMs = Math.max(5_000, params.ttlMs);
        const expiresAt = new Date(params.nowMs + ttlMs).toISOString();
        const lease: AccountRuntimeLease = { ...head.lease, expiresAt };
        const snapshot: AccountRuntimeSnapshot = {
          ...toWorkerRuntimeSnapshot(head.snapshot),
          expiresAt,
        };
        file.heads[key] = { snapshot, lease };
        await this.write(file);
        return lease;
      }
      return null;
    });
  }

  async heartbeat(params: {
    tenantId: string;
    userId: string;
    executionId: string;
    decisionId: string;
    snapshotVersion: number;
    runtimeLeaseId: string;
    nowMs: number;
    quotaAllowed: boolean;
    concurrencyAllowed: boolean;
    checkedAt?: string;
  }): Promise<WorkerHeartbeatVerdict> {
    const head = await this.current(params);
    if (!head) {
      return { continueBilling: false, reason: "missing-snapshot" };
    }
    const checkedAt = params.checkedAt ?? new Date(params.nowMs).toISOString();
    const answer: ControlPlaneHeartbeatAnswer = {
      decisionValid:
        isGovernanceDecisionId(params.decisionId) && head.snapshot.decisionId === params.decisionId,
      currentSnapshotVersion: head.snapshot.snapshotVersion,
      leaseRevoked: head.snapshot.revoked || head.lease.revoked,
      leaseExpiresAt: head.lease.expiresAt,
      quotaAllowed: params.quotaAllowed,
      concurrencyAllowed: params.concurrencyAllowed,
      checkedAt,
      runtimeLeaseId: head.lease.runtimeLeaseId,
    };
    const hold = projectWorkerBillingHold({
      snapshot: head.snapshot,
      lease: {
        runtimeLeaseId: params.runtimeLeaseId,
        expiresAt: head.lease.expiresAt,
        revoked: false,
        snapshotVersion: params.snapshotVersion,
      },
    });
    hold.decisionId = params.decisionId;
    return evaluateAccountWorkerHeartbeat({ hold, answer, nowMs: params.nowMs });
  }

  private present(
    snapshot: AccountRuntimeSnapshot,
    lease: AccountRuntimeLease,
  ): IssuedAccountRuntime {
    const workerSnapshot = toWorkerRuntimeSnapshot(snapshot);
    const workerLease: AccountWorkerLease = {
      runtimeLeaseId: lease.runtimeLeaseId,
      expiresAt: lease.expiresAt,
      revoked: lease.revoked,
      snapshotVersion: lease.snapshotVersion,
    };
    return {
      snapshot: workerSnapshot,
      lease,
      workerSnapshot,
      hold: projectWorkerBillingHold({ snapshot: workerSnapshot, lease: workerLease }),
    };
  }
}
