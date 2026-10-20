/**
 * Runtime shape guards for GuidanceSnapshot (P0.1 negative-shape coverage).
 */

import { isGuidanceDegradeReason, isGuidanceScope, type GuidanceSnapshot } from "./types.js";

export type GuidanceSnapshotValidationIssue = {
  path: string;
  message: string;
};

const ACTION_RISKS = new Set(["low", "medium", "high"]);
const SOURCES = new Set(["growth", "daibai", "protocol", "collaboration", "orchestrator"]);
const BLOCKER_KINDS = new Set([
  "skill",
  "oauth",
  "knowledge_binding",
  "workflow",
  "permission",
  "data",
  "other",
]);

function push(issues: GuidanceSnapshotValidationIssue[], path: string, message: string) {
  issues.push({ path, message });
}

function validateNextAction(
  issues: GuidanceSnapshotValidationIssue[],
  path: string,
  value: unknown,
) {
  if (!value || typeof value !== "object") {
    push(issues, path, "must be an object");
    return;
  }
  const action = value as Record<string, unknown>;
  if (typeof action.kind !== "string" || !action.kind.trim()) {
    push(issues, `${path}.kind`, "required non-empty string");
  }
  if (typeof action.label !== "string" || !action.label.trim()) {
    push(issues, `${path}.label`, "required non-empty string");
  }
  if (typeof action.reason !== "string" || !action.reason.trim()) {
    push(issues, `${path}.reason`, "required non-empty string");
  }
  if (typeof action.canSkip !== "boolean") {
    push(issues, `${path}.canSkip`, "required boolean");
  }
  if (typeof action.risk !== "string" || !ACTION_RISKS.has(action.risk)) {
    push(issues, `${path}.risk`, "must be low|medium|high");
  }
}

/** Returns validation issues; empty array means the snapshot is well-formed. */
export function validateGuidanceSnapshot(value: unknown): GuidanceSnapshotValidationIssue[] {
  const issues: GuidanceSnapshotValidationIssue[] = [];
  if (!value || typeof value !== "object") {
    push(issues, "", "snapshot must be an object");
    return issues;
  }
  const snap = value as Record<string, unknown>;

  if (!isGuidanceScope(snap.scope)) {
    push(issues, "scope", "must be user|robot|team");
  }
  if (typeof snap.scenario !== "string" || !snap.scenario.trim()) {
    push(issues, "scenario", "required non-empty string");
  }
  if (snap.confidence !== "high" && snap.confidence !== "medium" && snap.confidence !== "low") {
    push(issues, "confidence", "must be high|medium|low");
  }
  if (typeof snap.currentStage !== "string" || !snap.currentStage.trim()) {
    push(issues, "currentStage", "required non-empty string");
  }
  validateNextAction(issues, "nextAction", snap.nextAction);
  if (!Array.isArray(snap.optionalActions)) {
    push(issues, "optionalActions", "required array");
  } else {
    snap.optionalActions.forEach((item, index) => {
      validateNextAction(issues, `optionalActions[${index}]`, item);
    });
  }
  if (!Array.isArray(snap.blockers)) {
    push(issues, "blockers", "required array");
  } else {
    snap.blockers.forEach((item, index) => {
      if (!item || typeof item !== "object") {
        push(issues, `blockers[${index}]`, "must be an object");
        return;
      }
      const blocker = item as Record<string, unknown>;
      if (typeof blocker.code !== "string" || !blocker.code.trim()) {
        push(issues, `blockers[${index}].code`, "required non-empty string");
      }
      if (typeof blocker.kind !== "string" || !BLOCKER_KINDS.has(blocker.kind)) {
        push(issues, `blockers[${index}].kind`, "invalid blocker kind");
      }
      if (typeof blocker.label !== "string" || !blocker.label.trim()) {
        push(issues, `blockers[${index}].label`, "required non-empty string");
      }
      if (typeof blocker.actionable !== "boolean") {
        push(issues, `blockers[${index}].actionable`, "required boolean");
      }
    });
  }
  if (!isGuidanceDegradeReason(snap.degrade)) {
    push(issues, "degrade", "invalid degrade reason");
  }
  // Isolation keys must be present (null allowed). Missing key is a shape error.
  if (!("tenantId" in snap)) {
    push(issues, "tenantId", "required isolation field (string|null)");
  } else if (snap.tenantId != null && typeof snap.tenantId !== "string") {
    push(issues, "tenantId", "must be string|null");
  }
  if (!("userId" in snap)) {
    push(issues, "userId", "required isolation field (string|null)");
  } else if (snap.userId != null && typeof snap.userId !== "string") {
    push(issues, "userId", "must be string|null");
  }
  if (typeof snap.entityId !== "string" || !snap.entityId.trim()) {
    push(issues, "entityId", "required non-empty string");
  }
  if (typeof snap.source !== "string" || !SOURCES.has(snap.source)) {
    push(issues, "source", "invalid source");
  }
  if (typeof snap.generatedAt !== "number" || !Number.isFinite(snap.generatedAt)) {
    push(issues, "generatedAt", "required finite number");
  }
  if (
    snap.expiresAt !== undefined &&
    (typeof snap.expiresAt !== "number" || !Number.isFinite(snap.expiresAt))
  ) {
    push(issues, "expiresAt", "must be finite number when present");
  }
  return issues;
}

export function isValidGuidanceSnapshot(value: unknown): value is GuidanceSnapshot {
  return validateGuidanceSnapshot(value).length === 0;
}
