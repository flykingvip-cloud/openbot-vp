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
  | { kind: "accepted_turn"; admission: TurnExecutionAdmission }
  | { kind: "duplicate"; binding: TaskCompletionBinding }
  | { kind: "rejected"; reason: string };

/** Host-authorized current-turn scope, not a task, recovery ticket or tool permission. */
export type TurnExecutionAdmission = {
  requestId: string;
  sessionFile: string;
  goal: string;
  acceptance: readonly string[];
  focusRevision: number;
  writeEpoch: number;
};
