import {
  admitExecutionRequest,
  bindExecutionAdmissionPorts,
  type ExecutionAdmissionInput,
  type ExecutionAdmissionPorts,
} from "../command/index.js";
import { sessionTaskState } from "../state/index.js";

/** Fixed persistence binding; admission remains in command, state remains atomic. */
export function admitSessionExecution(
  sessionFile: string,
  input: ExecutionAdmissionInput,
  authorize: ExecutionAdmissionPorts["authorize"],
) {
  return admitExecutionRequest(
    input,
    bindExecutionAdmissionPorts({
      sessionFile,
      authorize,
      commit: sessionTaskState.admitExecution,
      copyAcceptance: true,
    }),
  );
}
