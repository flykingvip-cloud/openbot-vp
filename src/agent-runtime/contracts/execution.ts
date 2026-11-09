import type { InteractionExecutionRequest } from "./interaction.js";
import type { TaskCompletionBinding } from "./task-binding.js";

/** Accounting fact shared by execution and outcome projection. */
export type CommandCandidateChargeState =
  | "not_attempted"
  | "attempted_unknown"
  | "committed"
  | "conflict"
  | "evidence_missing"
  | "absent"
  | "no_effect";

/** Trusted ingress identity and revision; never accepted from model output. */
export type ExecutionAdmissionInput = {
  requestId: string;
  expectedFocusRevision: number;
  expectedWriteEpoch: number;
  expectedTaskId?: string;
  proposal: InteractionExecutionRequest;
  abortSignal?: AbortSignal;
};
export type ExecutionAdmissionResult =
  | { kind: "accepted"; binding: TaskCompletionBinding; acceptance: readonly string[] }
  | { kind: "duplicate"; binding: TaskCompletionBinding }
  | { kind: "rejected"; reason: string };
