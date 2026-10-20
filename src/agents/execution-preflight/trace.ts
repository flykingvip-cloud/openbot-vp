import { randomUUID } from "node:crypto";
import type { ExecutionTraceRecord } from "./types.js";

const traces: ExecutionTraceRecord[] = [];
const attempts = new Map<string, number>();

export function resolveExecutionTaskId(runId: string | undefined): string {
  const trimmed = runId?.trim();
  return trimmed || `task-${randomUUID()}`;
}

export function resetExecutionTraceForTest(): void {
  traces.length = 0;
  attempts.clear();
}

export function nextAttemptNumber(taskId: string): number {
  const next = (attempts.get(taskId) ?? 0) + 1;
  attempts.set(taskId, next);
  return next;
}

function cleanToken(value: string | undefined, max = 80): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.slice(0, max);
}

/** Accepts only the trace fields. Callers cannot attach prompt text, secrets, or tool args. */
export function recordExecutionTrace(record: ExecutionTraceRecord): ExecutionTraceRecord {
  const stored: ExecutionTraceRecord = {
    taskId: cleanToken(record.taskId, 120) ?? "missing-task",
    sessionId: cleanToken(record.sessionId, 120) ?? "missing-session",
    attemptNumber: Number.isInteger(record.attemptNumber) ? record.attemptNumber : 0,
    intentClass: cleanToken(record.intentClass, 40) ?? "chat",
    decisionStage: cleanToken(record.decisionStage, 40) ?? "preflight",
    decisionCode: cleanToken(record.decisionCode, 80) ?? "unknown",
    ...(cleanToken(record.primarySkill) ? { primarySkill: cleanToken(record.primarySkill) } : {}),
    ...(cleanToken(record.toolName) ? { toolName: cleanToken(record.toolName) } : {}),
    ...(typeof record.retryable === "boolean" ? { retryable: record.retryable } : {}),
    ...(cleanToken(record.fallback, 40) ? { fallback: cleanToken(record.fallback, 40) } : {}),
    ...(record.deliveryOutcome ? { deliveryOutcome: record.deliveryOutcome } : {}),
    ...(cleanToken(record.validatorId) ? { validatorId: cleanToken(record.validatorId) } : {}),
    ...(cleanToken(record.validatorVersion, 40)
      ? { validatorVersion: cleanToken(record.validatorVersion, 40) }
      : {}),
    ...(cleanToken(record.artifactPathHash, 64)
      ? { artifactPathHash: cleanToken(record.artifactPathHash, 64) }
      : {}),
    ...(cleanToken(record.artifactSha256, 64)
      ? { artifactSha256: cleanToken(record.artifactSha256, 64) }
      : {}),
    ...(record.transportOutcome ? { transportOutcome: record.transportOutcome } : {}),
    ...(record.cleanupReason ? { cleanupReason: record.cleanupReason } : {}),
    ...(record.hookJobIdHash ? { hookJobIdHash: record.hookJobIdHash } : {}),
    ...(record.cronRunIdHash ? { cronRunIdHash: record.cronRunIdHash } : {}),
    ...(record.attemptTaskIdHash ? { attemptTaskIdHash: record.attemptTaskIdHash } : {}),
    ...(record.hookDeliveryPresent !== undefined
      ? { hookDeliveryPresent: record.hookDeliveryPresent }
      : {}),
    ...(record.validatorsRequired !== undefined
      ? { validatorsRequired: record.validatorsRequired }
      : {}),
    ...(record.hookDeliveryDecisionCode
      ? { hookDeliveryDecisionCode: record.hookDeliveryDecisionCode }
      : {}),
    ...(record.hookDeliveryTaskMatch !== undefined
      ? { hookDeliveryTaskMatch: record.hookDeliveryTaskMatch }
      : {}),
  };
  traces.push(stored);
  return stored;
}

export function readExecutionTraces(taskId: string): ExecutionTraceRecord[] {
  return traces.filter((record) => record.taskId === taskId);
}
