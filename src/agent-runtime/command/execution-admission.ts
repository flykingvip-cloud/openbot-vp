import type { InteractionExecutionRequest } from "../contracts/interaction.js";
import type { TaskCompletionBinding } from "../contracts/task.js";

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
export type ExecutionAdmissionPorts = {
  authorize: (input: ExecutionAdmissionInput) => Promise<boolean>;
  /** Must revalidate captured identity/version and persist under the existing state lock. */
  commit: (input: ExecutionAdmissionInput) => ExecutionAdmissionResult;
};

/** A model proposal alone never creates a task or starts execution. */
export async function admitExecutionRequest(
  input: ExecutionAdmissionInput,
  ports: ExecutionAdmissionPorts,
): Promise<ExecutionAdmissionResult> {
  input.abortSignal?.throwIfAborted();
  if (
    !input.requestId.trim() ||
    !input.proposal.goal.trim() ||
    !input.proposal.acceptance.length ||
    input.proposal.acceptance.some((item) => !item.trim()) ||
    !Number.isSafeInteger(input.expectedFocusRevision) ||
    input.expectedFocusRevision < 0 ||
    !Number.isSafeInteger(input.expectedWriteEpoch) ||
    input.expectedWriteEpoch < 0
  ) {
    return { kind: "rejected", reason: "invalid_request" };
  }
  if (!(await ports.authorize(input))) {
    return { kind: "rejected", reason: "unauthorized" };
  }
  input.abortSignal?.throwIfAborted();
  return ports.commit(input);
}
