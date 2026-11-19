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
  state: "started" | "succeeded";
  startedAtMs: number;
  completedAtMs?: number;
  result?: T;
};
