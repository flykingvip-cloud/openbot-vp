/** Model interpretation is a proposal. Execution admission remains a host decision. */
export type InteractionExecutionRequest = {
  goal: string;
  acceptance: string[];
};
export type InteractionModelDecision =
  | { kind: "reply"; text: string }
  | { kind: "clarify"; text: string }
  | { kind: "execution_request"; request: InteractionExecutionRequest };

export type InteractionModelInput = {
  message: string;
  /** Already authorized and budgeted shared view; never reclassified as system authority here. */
  context: readonly { role: "system" | "user" | "assistant"; content: string }[];
  abortSignal?: AbortSignal;
};
