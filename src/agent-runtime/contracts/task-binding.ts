/** Admission / completion binding aggregate — type-only; not the persisted board. */

/** Binding captured at request admission and carried across queue/execution/completion. */
export type TaskCompletionBinding = {
  /** Accepted constraints captured when this attempt is claimed; never model supplied. */
  constraints?: readonly string[];
  taskId: string;
  /** Persisted logical execution; distinct from retry/recovery attempt. */
  logicalExecutionId?: string;
  executionAttempt?: string;
  deliverableVersion?: string;
};

export type CurrentTaskResumeRequest = {
  taskId: string;
  expectedFocusRevision: number;
  expectedWriteEpoch: number;
};

export type CurrentTaskResumeResult =
  | { kind: "accepted"; binding: TaskCompletionBinding; acceptance: readonly string[] }
  | { kind: "rejected"; reason: string };

/** Trusted snapshot captured by the host before task side effects. */
export type TaskActionBoundary = {
  sessionFile: string;
  binding: TaskCompletionBinding;
  constraints: readonly string[];
};
