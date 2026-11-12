import type { InteractionAvailability } from "./interaction-availability.js";
import type { TaskAcceptanceCheck } from "./quality.js";
/**
 * Host marker when plain text was adapted to a reply.
 * It is not an admission result and must not be treated as one if a model copies it.
 */
export const INTERACTION_PROSE_PROTOCOL_DOWNGRADE = "prose_downgrade" as const;
/** Model interpretation is a proposal. Execution admission remains a host decision. */
export type InteractionExecutionRequest = {
  /** Only explicit long-task planning opens the persistent task board. Omitted means turn. */
  lifecycle?: "turn" | "long_task";
  goal: string;
  acceptance: string[];
  checks?: TaskAcceptanceCheck[];
};
export type InteractionTaskTarget = { taskId: string; revision: string };
export type InteractionModelDecision =
  | {
      kind: "reply";
      text: string;
      /** Host-only diagnostic. Never grants admission. */
      protocolDowngrade?: typeof INTERACTION_PROSE_PROTOCOL_DOWNGRADE;
    }
  | { kind: "clarify"; text: string }
  | {
      kind: "task_change";
      target: InteractionTaskTarget;
      text: string;
      mode?: "supplement" | "revise" | "replace_all";
      answer?: string;
    }
  | {
      kind: "task_control";
      target: InteractionTaskTarget;
      action: "pause" | "cancel" | "resume";
      answer?: string;
    }
  | { kind: "execution_request"; request: InteractionExecutionRequest };

export type InteractionModelInput = {
  /** Trusted source availability. Does not waive model or identity authorization. */
  availability?: InteractionAvailability;
  message: string;
  /** Authorized, sanitized inbound pixels; no tool permission is implied. */
  images?: readonly { type: "image"; data: string; mimeType: string }[];
  /** Captured by the trusted host, never inferred from quoted history. */
  taskTarget?: InteractionTaskTarget;
  /** Already authorized and budgeted shared view; never reclassified as system authority here. */
  context: readonly { role: "system" | "user" | "assistant"; content: string }[];
  abortSignal?: AbortSignal;
};
