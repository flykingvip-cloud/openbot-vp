import path from "node:path";
import { resolveAgentDir, resolveSessionAgentId } from "../../agents/agent-scope.js";
import { TASK_OUTCOME_STORE_DIRNAME } from "../../task-outcome/runtime-from-runner.js";
import { confirmPendingTurnDeliveryWithPorts } from "../delivery/index.js";
import { sessionTaskState } from "../state/index.js";
import { markAsyncWaitRecoveryDelivered } from "../state/index.js";
/** Bind fixed host state/storage effects; delivery owns receipt decisions. */
export function confirmPendingTurnDelivery(
  params: Parameters<typeof confirmPendingTurnDeliveryWithPorts>[0],
) {
  return confirmPendingTurnDeliveryWithPorts(params, {
    resolvePersistRoot: (config, sessionKey) =>
      path.join(
        resolveAgentDir(config, resolveSessionAgentId({ sessionKey, config })),
        TASK_OUTCOME_STORE_DIRNAME,
      ),
    completeTask: sessionTaskState.completeChecked,
    bindingCurrent: sessionTaskState.bindingCurrent,
    recordRecoveryDelivered: markAsyncWaitRecoveryDelivered,
  });
}
