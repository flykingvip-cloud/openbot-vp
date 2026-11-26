import { createHash } from "node:crypto";
import type { WaitCondition } from "./execution-protocol.js";
/** Durable logical operation identity survives retries; attempt identity is separate. */
export type OperationIdentity = {
  tenantId: string;
  taskId: string;
  executionId: string;
  stepId: string;
  operationId: string;
};

/** An interrupted external write is unknown until evidence confirms its outcome. */
export type OperationRecoveryDecision =
  | { kind: "confirmed"; evidenceId: string }
  | { kind: "not_applied"; evidenceId: string }
  | { kind: "unknown"; reason: string };

export type PersistedOperation<T = unknown> = {
  version: 1;
  operationId: string;
  state: "started" | "prepared" | "not_issued" | "intent" | "unknown" | "succeeded";
  attemptId?: string;
  fencingGeneration?: number;
  scopeFingerprint?: string;
  refusals?: Array<{ attemptId: string; atMs: number; reason: string }>;
  startedAtMs: number;
  completedAtMs?: number;
  result?: T;
  wait?: { condition: WaitCondition; nextQueryAtMs: number; attempts: number };
};

/** Versioned canonical tuple: excludes attemptId so retries preserve logical identity. */
export function executionOperationKey(identity: OperationIdentity): string {
  const fields = [
    identity.tenantId,
    identity.taskId,
    identity.executionId,
    identity.stepId,
    identity.operationId,
  ];
  if (fields.some((value) => !value.trim() || value !== value.trim())) {
    throw new Error("Operation identity requires canonical non-empty fields");
  }
  return `operation:v1:${createHash("sha256").update(JSON.stringify(fields)).digest("hex")}`;
}

export type ExecutionIngress = "chat" | "scheduled" | "recovery" | "subagent" | "fabric";

/** Trusted persisted references only: a schedule occurrence differs from its schedule. */
export function operationIdentityFromIngress(input: {
  ingress: ExecutionIngress;
  originalIngress?: Exclude<ExecutionIngress, "recovery">;
  tenantId: string;
  taskId: string;
  persistedExecutionId: string;
  persistedStepId: string;
  persistedOperationId: string;
}): OperationIdentity {
  if (input.ingress === "recovery" && !input.originalIngress) {
    throw new Error("Recovery requires original persisted ingress");
  }
  const identity: OperationIdentity = {
    tenantId: input.tenantId,
    taskId: input.taskId,
    executionId: `${input.originalIngress ?? input.ingress}:${input.persistedExecutionId}`,
    stepId: input.persistedStepId,
    operationId: input.persistedOperationId,
  };
  if (
    !input.persistedExecutionId.trim() ||
    input.persistedExecutionId !== input.persistedExecutionId.trim()
  ) {
    throw new Error("Ingress requires a persisted logical execution identity");
  }
  executionOperationKey(identity);
  return identity;
}
