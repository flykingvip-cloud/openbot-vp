import type { ExecutionAdmissionInput, ExecutionAdmissionResult } from "../contracts/execution.js";
import type { TaskAcceptanceCheck } from "../contracts/quality.js";
import { parseTaskAcceptanceChecks, isRecoverableInteractionSourceError } from "../policy/index.js";
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
  const parsedChecks = parseTaskAcceptanceChecks(
    input.proposal.checks,
    input.proposal.acceptance.length,
  );
  if (!parsedChecks.ok) {
    return { kind: "rejected", reason: "invalid_acceptance_checks" };
  }
  input = {
    ...input,
    proposal: {
      ...input.proposal,
      acceptance: [...input.proposal.acceptance],
      ...(input.proposal.checks !== undefined ? { checks: parsedChecks.checks } : {}),
    },
  };
  if (
    !input.requestId.trim() ||
    !input.proposal.goal.trim() ||
    (input.proposal.lifecycle !== undefined &&
      input.proposal.lifecycle !== "turn" &&
      input.proposal.lifecycle !== "long_task") ||
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

/** Fixed mapping into the existing atomic task writer. No execution is started here. */
export function bindExecutionAdmissionPorts(params: {
  sessionFile: string;
  authorize: ExecutionAdmissionPorts["authorize"];
  commit: (input: {
    sessionFile: string;
    requestId: string;
    goal: string;
    lifecycle?: "turn" | "long_task";
    acceptance: readonly string[];
    checks?: readonly TaskAcceptanceCheck[];
    expectedFocusRevision: number;
    expectedWriteEpoch: number;
    expectedTaskId?: string;
  }) =>
    | Exclude<ExecutionAdmissionResult, { kind: "accepted" }>
    | {
        kind: "accepted";
        binding: Extract<ExecutionAdmissionResult, { kind: "accepted" }>["binding"];
      };
  copyAcceptance?: boolean;
}): ExecutionAdmissionPorts {
  return {
    authorize: params.authorize,
    commit: (request) => {
      let result: ReturnType<typeof params.commit>;
      try {
        result = params.commit({
          sessionFile: params.sessionFile,
          requestId: request.requestId,
          goal: request.proposal.goal,
          lifecycle: request.proposal.lifecycle ?? "turn",
          acceptance: request.proposal.acceptance,
          ...(request.proposal.checks !== undefined ? { checks: request.proposal.checks } : {}),
          expectedFocusRevision: request.expectedFocusRevision,
          expectedWriteEpoch: request.expectedWriteEpoch,
          expectedTaskId: request.expectedTaskId,
        });
      } catch (error) {
        if (!isRecoverableInteractionSourceError(error)) {
          throw error;
        }
        // A writer may have partially completed. Never retry or claim no state changed.
        return { kind: "rejected", reason: "task_mutation_unconfirmed" };
      }
      return result.kind === "accepted"
        ? {
            ...result,
            acceptance: params.copyAcceptance
              ? [...request.proposal.acceptance]
              : request.proposal.acceptance,
          }
        : result;
    },
  };
}
