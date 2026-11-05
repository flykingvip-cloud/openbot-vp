import {
  admitExecutionRequest,
  type ExecutionAdmissionInput,
  type ExecutionAdmissionPorts,
} from "../command/index.js";
import { sessionTaskState } from "../state/session-task.js";

/** Fixed persistence binding; admission remains in command, state remains atomic. */
export function admitSessionExecution(
  sessionFile: string,
  input: ExecutionAdmissionInput,
  authorize: ExecutionAdmissionPorts["authorize"],
) {
  return admitExecutionRequest(input, {
    authorize,
    commit: (request) => {
      const result = sessionTaskState.admitExecution({
        sessionFile,
        requestId: request.requestId,
        goal: request.proposal.goal,
        acceptance: request.proposal.acceptance,
        expectedFocusRevision: request.expectedFocusRevision,
        expectedWriteEpoch: request.expectedWriteEpoch,
        expectedTaskId: request.expectedTaskId,
      });
      return result.kind === "accepted"
        ? { ...result, acceptance: [...request.proposal.acceptance] }
        : result;
    },
  });
}
