/** Durable cutover states (P0-d). Kept snake_case for machine persistence. */
export type WorkspaceCutoverState =
  | "inventoried"
  | "prepared"
  | "write_frozen"
  | "copied_or_adopted"
  | "verified"
  | "dual_read_verified"
  | "resolver_write_cutover"
  | "compatibility_read_only"
  | "retired"
  | "failed";

export type WorkspaceCutoverOperation = {
  operationId: string;
  resourceId: string;
  sourceBindingId: string;
  targetBindingId: string;
  expectedContentVersion: string;
  state: WorkspaceCutoverState;
  retryCount: number;
  lastError: string | null;
  /** Optional deadline for compatibility reads after cutover (epoch ms). */
  compatibilityReadDeadlineMs: number | null;
  compatibilityReadAuditCount: number;
  createdAtMs: number;
  updatedAtMs: number;
};

export type CreateWorkspaceCutoverOperationParams = {
  operationId: string;
  resourceId: string;
  sourceBindingId: string;
  targetBindingId: string;
  expectedContentVersion: string;
  nowMs?: number;
};

export type TransitionWorkspaceCutoverParams = {
  operation: WorkspaceCutoverOperation;
  nextState: WorkspaceCutoverState;
  nowMs?: number;
  lastError?: string | null;
  bumpRetry?: boolean;
};
