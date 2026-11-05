/** Model interpretation is a proposal. Execution admission remains a host decision. */
export type InteractionExecutionRequest = {
  goal: string;
  acceptance: string[];
};
export type InteractionTaskTarget = { taskId: string; revision: string };
export type InteractionModelDecision =
  | { kind: "reply"; text: string }
  | { kind: "clarify"; text: string }
  | { kind: "task_change"; target: InteractionTaskTarget; text: string }
  | { kind: "task_control"; target: InteractionTaskTarget; action: "pause" | "cancel" | "resume" }
  | { kind: "execution_request"; request: InteractionExecutionRequest };

export type InteractionModelInput = {
  message: string;
  /** Captured by the trusted host, never inferred from quoted history. */
  taskTarget?: InteractionTaskTarget;
  /** Already authorized and budgeted shared view; never reclassified as system authority here. */
  context: readonly { role: "system" | "user" | "assistant"; content: string }[];
  abortSignal?: AbortSignal;
};
