/**
 * Full trusted-scope equality and the immutable snapshot identity checked on replay.
 * Domain id alone is not enough: tenant and authorization scope are part of the identity.
 */
import { createHash } from "node:crypto";
import type { TrustedScope } from "../task-outcome/types.js";

export function fullScopeEqual(left: TrustedScope, right: TrustedScope): boolean {
  if (left.kind !== right.kind || left.subjectRef !== right.subjectRef) {
    return false;
  }
  if (left.authzScopeRef !== right.authzScopeRef) {
    return false;
  }
  if (left.kind === "personal" && right.kind === "personal") {
    return left.personalDomainId === right.personalDomainId;
  }
  if (left.kind === "enterprise" && right.kind === "enterprise") {
    return left.enterpriseDomainId === right.enterpriseDomainId && left.tenantId === right.tenantId;
  }
  return false;
}

export const SNAPSHOT_IDENTITY_SCHEMA_VERSION = 2 as const;

/**
 * Version 2 covers the final decision the reader trusts.
 * It is not a digest of the budget ledger or of created/updated/decided timestamps.
 */
export const SNAPSHOT_IDENTITY_COVERS = [
  "taskId",
  "outcomeVersion",
  "scope",
  "lifecycle",
  "taskJudgement",
  "revisionKind",
  "acceptance",
  "delivery",
  "deliveryId",
  "runs",
  "attempts",
] as const;

export const SNAPSHOT_IDENTITY_DOES_NOT_COVER = [
  "budget",
  "spentCostUsd",
  "createdAt",
  "updatedAt",
  "decidedAt",
  "fencingToken",
] as const;

function gateProjection(gate: unknown): { status: string; reason: string | null } | null {
  if (!gate || typeof gate !== "object") {
    return null;
  }
  const status = (gate as { status?: unknown }).status;
  const reason = (gate as { reason?: unknown }).reason;
  return {
    status: typeof status === "string" ? status : "",
    reason: typeof reason === "string" ? reason : null,
  };
}

function runProjection(runs: unknown): Array<{
  runId: string;
  attemptIds: string[];
  effectiveAttemptId: string | null;
  status: string;
}> {
  if (!Array.isArray(runs)) {
    return [];
  }
  return runs.map((run) => {
    const row = run && typeof run === "object" ? (run as Record<string, unknown>) : {};
    const attemptIds = Array.isArray(row.attemptIds)
      ? row.attemptIds.filter((id): id is string => typeof id === "string")
      : [];
    return {
      runId: typeof row.runId === "string" ? row.runId : "",
      attemptIds,
      effectiveAttemptId:
        typeof row.effectiveAttemptId === "string" ? row.effectiveAttemptId : null,
      status: typeof row.status === "string" ? row.status : "",
    };
  });
}

function attemptProjection(attempts: unknown): Array<{
  attemptId: string;
  runId: string;
  status: string;
}> {
  if (!Array.isArray(attempts)) {
    return [];
  }
  return attempts.map((attempt) => {
    const row = attempt && typeof attempt === "object" ? (attempt as Record<string, unknown>) : {};
    return {
      attemptId: typeof row.attemptId === "string" ? row.attemptId : "",
      runId: typeof row.runId === "string" ? row.runId : "",
      status: typeof row.status === "string" ? row.status : "",
    };
  });
}

/**
 * Version 2 covers the fields a final reader actually trusts:
 * acceptance, delivery, runs (including effectiveAttemptId) and attempts.
 */
export function snapshotIdentityFingerprint(record: {
  taskId: string;
  outcomeVersion: number;
  scope: TrustedScope;
  lifecycle: string;
  taskJudgement: string;
  revisionKind?: string;
  acceptance?: unknown;
  delivery?: unknown;
  deliveryId?: string | null;
  runs?: unknown;
  attempts?: unknown;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: SNAPSHOT_IDENTITY_SCHEMA_VERSION,
        taskId: record.taskId,
        outcomeVersion: record.outcomeVersion,
        scope: record.scope,
        lifecycle: record.lifecycle,
        taskJudgement: record.taskJudgement,
        revisionKind: record.revisionKind ?? null,
        acceptance: gateProjection(record.acceptance),
        delivery: gateProjection(record.delivery),
        deliveryId: record.deliveryId ?? null,
        runs: runProjection(record.runs),
        attempts: attemptProjection(record.attempts),
      }),
    )
    .digest("hex");
}

export function snapshotStructureValid(record: { attempts?: unknown; runs?: unknown }): boolean {
  if (record.attempts != null && !Array.isArray(record.attempts)) {
    return false;
  }
  if (record.runs != null && !Array.isArray(record.runs)) {
    return false;
  }
  if (Array.isArray(record.attempts)) {
    for (const attempt of record.attempts) {
      if (!attempt || typeof attempt !== "object") {
        return false;
      }
      const row = attempt as { attemptId?: unknown; runId?: unknown };
      if (typeof row.attemptId !== "string" || typeof row.runId !== "string") {
        return false;
      }
    }
  }
  if (Array.isArray(record.runs)) {
    for (const run of record.runs) {
      if (!run || typeof run !== "object") {
        return false;
      }
      const row = run as { runId?: unknown; attemptIds?: unknown };
      if (typeof row.runId !== "string" || !Array.isArray(row.attemptIds)) {
        return false;
      }
      if (!row.attemptIds.every((id) => typeof id === "string")) {
        return false;
      }
    }
  }
  return true;
}
