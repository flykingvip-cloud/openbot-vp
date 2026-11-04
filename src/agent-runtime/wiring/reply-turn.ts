import path from "node:path";
import { resolveAgentDir } from "../../agents/agent-scope.js";
import type { OpenBotConfig } from "../../config/config.js";
import { TASK_OUTCOME_STORE_DIRNAME } from "../../task-outcome/runtime-from-runner.js";
import { handleActiveTurn } from "../command/index.js";
import {
  buildReplyPayloads,
  completeReplyDelivery,
  prepareVisibleDelivery,
} from "../delivery/index.js";
import { runAdmittedTurn } from "../execution/index.js";
import { sessionTaskState } from "../state/session-task.js";
import { bindAdmittedTurnHost } from "./admitted-turn-host.js";
import { bindActiveTurnPorts } from "./command-adapters.js";

/** Compose the original reply-turn dependencies. The reply host owns transport and cleanup. */
export const replyTurnRuntime = {
  command: {
    handle(
      input: Parameters<typeof handleActiveTurn>[0],
      host: Parameters<typeof bindActiveTurnPorts>[0],
    ) {
      return handleActiveTurn(input, bindActiveTurnPorts(host));
    },
  },
  state: sessionTaskState,
  execution: {
    runAdmittedTurn(request: Parameters<typeof runAdmittedTurn>[0]) {
      return runAdmittedTurn(request, bindAdmittedTurnHost());
    },
  },
  delivery: {
    buildReplyPayloads,
    completeReplyDelivery,
    prepareVisibleDelivery(
      config: OpenBotConfig,
      request: Omit<Parameters<typeof prepareVisibleDelivery>[0], "resolvePersistRoot">,
    ) {
      return prepareVisibleDelivery({
        ...request,
        resolvePersistRoot: (agentId) =>
          path.join(resolveAgentDir(config, agentId), TASK_OUTCOME_STORE_DIRNAME),
      });
    },
  },
};
