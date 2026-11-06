import type { ExecutionAdmissionInput, ExecutionAdmissionResult } from "../contracts/execution.js";
export type { ExecutionAdmissionInput, ExecutionAdmissionResult } from "../contracts/execution.js";

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
