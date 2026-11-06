/** Read-only metadata projection. Never opens the recovering/writing durable store. */
import fs from "node:fs";
import path from "node:path";
import type { OpenBotConfig } from "../config/config.js";
import {
  callerOwnsTaskOutcome,
  resolveConfiguredTaskOutcomeRoot,
} from "../task-outcome/reject-result.js";
import { boundedOutcomePathSegment } from "../task-outcome/store.js";
import type { TaskOutcomeRecord, TrustedScope } from "../task-outcome/types.js";
import {
  readOutcomeCohort,
  cohortDimensionsKey,
  type CohortDimensions,
} from "./cohort-identity.js";

export type OutcomeRecordMetadata = Pick<
  TaskOutcomeRecord,
  | "scope"
  | "taskId"
  | "outcomeVersion"
  | "taskJudgement"
  | "lifecycle"
  | "decidedAt"
  | "decisiveRunId"
  | "decisiveAttemptId"
  | "deliveryId"
> & {
  cohortDimensions?: CohortDimensions;
  acceptance: Pick<TaskOutcomeRecord["acceptance"], "status">;
  delivery: Pick<TaskOutcomeRecord["delivery"], "status">;
  runs: Pick<
    TaskOutcomeRecord["runs"][number],
    "runId" | "attemptIds" | "effectiveAttemptId" | "status"
  >[];
  attempts: Pick<
    TaskOutcomeRecord["attempts"][number],
    "attemptId" | "runId" | "status" | "observedAt"
  >[];
};
export type OutcomeMetadata = OutcomeRecordMetadata & { isCurrentTip: boolean };
export type OutcomeReadResult =
  | { ok: true; outcome: OutcomeMetadata }
  | {
      ok: false;
      code:
        | "unauthorized"
        | "agent_unresolved"
        | "not_found"
        | "version_missing"
        | "invalid_record"
        | "scope_conflict"
        | "tip_changed"
        | "read_failed";
    };
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function scope(value: unknown): value is TrustedScope {
  if (!object(value) || !nonempty(value.subjectRef) || !nonempty(value.authzScopeRef)) {
    return false;
  }
  return value.kind === "personal"
    ? nonempty(value.personalDomainId)
    : value.kind === "enterprise" && nonempty(value.tenantId) && nonempty(value.enterpriseDomainId);
}
function record(value: unknown): value is OutcomeRecordMetadata {
  if (
    !object(value) ||
    !scope(value.scope) ||
    typeof value.taskId !== "string" ||
    !Number.isSafeInteger(value.outcomeVersion) ||
    Number(value.outcomeVersion) < 1
  ) {
    return false;
  }
  if (
    !["decisiveRunId", "decisiveAttemptId", "deliveryId"].every(
      (k) => value[k] === undefined || typeof value[k] === "string",
    )
  ) {
    return false;
  }
  if (
    !Array.isArray(value.runs) ||
    !value.runs.every(
      (r) =>
        object(r) &&
        typeof r.runId === "string" &&
        Array.isArray(r.attemptIds) &&
        r.attemptIds.every((a) => typeof a === "string") &&
        (r.effectiveAttemptId === undefined || typeof r.effectiveAttemptId === "string") &&
        ["succeeded", "failed", "cancelled", "timed_out", "none"].includes(String(r.status)),
    )
  ) {
    return false;
  }
  if (
    !Array.isArray(value.attempts) ||
    !value.attempts.every(
      (a) =>
        object(a) &&
        typeof a.attemptId === "string" &&
        typeof a.runId === "string" &&
        ["succeeded", "failed", "cancelled", "timed_out"].includes(String(a.status)) &&
        typeof a.observedAt === "string" &&
        Number.isFinite(Date.parse(a.observedAt)),
    )
  ) {
    return false;
  }
  return (
    ["success", "failure", "cancelled", "incomplete"].includes(String(value.taskJudgement)) &&
    ["active", "awaiting_acceptance", "awaiting_delivery", "recovering", "closed"].includes(
      String(value.lifecycle),
    ) &&
    typeof value.decidedAt === "string" &&
    Number.isFinite(Date.parse(value.decidedAt)) &&
    object(value.acceptance) &&
    ["pending", "passed", "failed", "not_required"].includes(String(value.acceptance.status)) &&
    object(value.delivery) &&
    ["pending", "blocked", "delivered", "delivery_unknown", "failed", "not_required"].includes(
      String(value.delivery.status),
    )
  );
}
function scopeKey(value: TrustedScope): string {
  return JSON.stringify(
    value.kind === "enterprise"
      ? [
          value.kind,
          value.subjectRef,
          value.authzScopeRef,
          value.tenantId,
          value.enterpriseDomainId,
        ]
      : [value.kind, value.subjectRef, value.authzScopeRef, value.personalDomainId],
  );
}
/** Canonical whitelist comparison ignores body fields and collection order. */
function metadataKey(row: OutcomeRecordMetadata): string {
  const runs = row.runs
    .map((r) => JSON.stringify([r.runId, r.attemptIds.toSorted(), r.effectiveAttemptId, r.status]))
    .toSorted();
  const attempts = row.attempts
    .map((a) => JSON.stringify([a.attemptId, a.runId, a.status, a.observedAt]))
    .toSorted();
  return JSON.stringify([
    scopeKey(row.scope),
    cohortDimensionsKey(row.cohortDimensions ?? readOutcomeCohort(row)),
    row.taskId,
    row.outcomeVersion,
    row.taskJudgement,
    row.lifecycle,
    row.decidedAt,
    row.acceptance.status,
    row.delivery.status,
    row.decisiveRunId,
    row.decisiveAttemptId,
    row.deliveryId,
    runs,
    attempts,
  ]);
}
export function readOutcomeMetadata(input: {
  cfg: OpenBotConfig;
  agentId: string;
  taskId: string;
  outcomeVersion: number;
  callerSubjectRef: string;
  callerTenantId?: string | null;
}): OutcomeReadResult {
  if (
    !input.callerSubjectRef ||
    !Number.isSafeInteger(input.outcomeVersion) ||
    input.outcomeVersion < 1 ||
    !input.taskId.trim()
  ) {
    return { ok: false, code: "unauthorized" };
  }
  const located = resolveConfiguredTaskOutcomeRoot(input.cfg, input.agentId);
  if (!located.ok) {
    return located;
  }
  const segment = boundedOutcomePathSegment(input.taskId);
  const tipPath = path.join(located.root, "tips", segment + ".json");
  const versionPath = path.join(
    located.root,
    "versions",
    segment + "__v" + input.outcomeVersion + ".json",
  );
  try {
    if (!fs.existsSync(tipPath)) {
      return { ok: false, code: "not_found" };
    }
    const tipText = fs.readFileSync(tipPath, "utf8");
    const tip: unknown = JSON.parse(tipText);
    if (!record(tip) || tip.taskId !== input.taskId) {
      return { ok: false, code: "invalid_record" };
    }
    if (
      !callerOwnsTaskOutcome({
        scope: tip.scope,
        callerSubjectRef: input.callerSubjectRef,
        callerTenantId: input.callerTenantId,
      })
    ) {
      return { ok: false, code: "unauthorized" };
    }
    if (!fs.existsSync(versionPath)) {
      return { ok: false, code: "version_missing" };
    }
    const snap: unknown = JSON.parse(fs.readFileSync(versionPath, "utf8"));
    if (
      !record(snap) ||
      snap.taskId !== input.taskId ||
      snap.outcomeVersion !== input.outcomeVersion ||
      snap.outcomeVersion > tip.outcomeVersion
    ) {
      return { ok: false, code: "invalid_record" };
    }
    if (scopeKey(tip.scope) !== scopeKey(snap.scope)) {
      return { ok: false, code: "scope_conflict" };
    }
    if (
      !callerOwnsTaskOutcome({
        scope: snap.scope,
        callerSubjectRef: input.callerSubjectRef,
        callerTenantId: input.callerTenantId,
      })
    ) {
      return { ok: false, code: "unauthorized" };
    }
    if (tip.outcomeVersion === snap.outcomeVersion && metadataKey(tip) !== metadataKey(snap)) {
      return { ok: false, code: "invalid_record" };
    }
    // A changing tip is retried by the caller, never silently paired with a different version.
    if (fs.readFileSync(tipPath, "utf8") !== tipText) {
      return { ok: false, code: "tip_changed" };
    }
    return {
      ok: true,
      outcome: {
        cohortDimensions: readOutcomeCohort(snap),
        taskId: snap.taskId,
        outcomeVersion: snap.outcomeVersion,
        taskJudgement: snap.taskJudgement,
        lifecycle: snap.lifecycle,
        decidedAt: snap.decidedAt,
        scope:
          snap.scope.kind === "enterprise"
            ? {
                kind: snap.scope.kind,
                subjectRef: snap.scope.subjectRef,
                authzScopeRef: snap.scope.authzScopeRef,
                tenantId: snap.scope.tenantId,
                enterpriseDomainId: snap.scope.enterpriseDomainId,
              }
            : {
                kind: snap.scope.kind,
                subjectRef: snap.scope.subjectRef,
                authzScopeRef: snap.scope.authzScopeRef,
                personalDomainId: snap.scope.personalDomainId,
              },
        acceptance: { status: snap.acceptance.status },
        delivery: { status: snap.delivery.status },
        decisiveRunId: snap.decisiveRunId,
        decisiveAttemptId: snap.decisiveAttemptId,
        deliveryId: snap.deliveryId,
        runs: snap.runs.map((r) => ({
          runId: r.runId,
          attemptIds: [...r.attemptIds],
          effectiveAttemptId: r.effectiveAttemptId,
          status: r.status,
        })),
        attempts: snap.attempts.map((a) => ({
          attemptId: a.attemptId,
          runId: a.runId,
          status: a.status,
          observedAt: a.observedAt,
        })),
        isCurrentTip: tip.outcomeVersion === snap.outcomeVersion,
      },
    };
  } catch {
    return { ok: false, code: "read_failed" };
  }
}
