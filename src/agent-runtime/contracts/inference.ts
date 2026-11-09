/** Shared provider input data; no command or execution ownership. */
export type AgentStreamParams = {
  /** Provider stream params override (best-effort). */
  temperature?: number;
  maxTokens?: number;
};
