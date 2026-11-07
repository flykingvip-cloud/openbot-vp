import path from "node:path";
import { resolveAgentDir } from "../../agents/agent-scope.js";
import type { OpenBotConfig } from "../../config/config.js";
import { TASK_OUTCOME_STORE_DIRNAME } from "../../task-outcome/runtime-from-runner.js";
import { handleInteraction } from "../command/index.js";
import {
  buildReplyPayloads,
  completeReplyDelivery,
  prepareVisibleDelivery,
} from "../delivery/index.js";
import {
  runAdmittedTurn,
  isTaskBoardContinueInternalPrompt,
  scheduleTaskBoardContinueWake,
} from "../execution/index.js";
import { sessionTaskState, prepareReplacementSessionEntry } from "../state/index.js";
import {
  persistInteractionMessage,
  persistRunSessionUsage,
  incrementRunCompactionCount,
} from "../state/index.js";
import { bindAdmittedTurnHost } from "./admitted-turn-host.js";
import {
  bindInteractionPorts,
  interruptInteractionTask,
  steerInteractionTask,
} from "./command-adapters.js";
import { confirmPendingTurnDelivery } from "./delivery-confirm.js";
import type { runGatewayInteraction } from "./interaction-turn.js";
import { evaluateBoundTaskAcceptance } from "./task-acceptance.js";

/** Compose the original reply-turn dependencies. The reply host owns transport and cleanup. */
export const replyTurnRuntime = {
  prepareReplacementSessionEntry,
  persistInteractionMessage,
  async interaction(...params: Parameters<typeof runGatewayInteraction>) {
    const runtime = await import("./interaction-turn.runtime.js");
    return runtime.runGatewayInteraction(...params);
  },
  interrupt: interruptInteractionTask,
  steer: steerInteractionTask,
  command: {
    handle(
      input: Parameters<typeof handleInteraction>[0],
      host: Parameters<typeof bindInteractionPorts>[0],
    ) {
      return handleInteraction(input, bindInteractionPorts(host));
    },
  },
  state: { ...sessionTaskState, persistRunSessionUsage, incrementRunCompactionCount },
  execution: {
    isTaskBoardContinueInternalPrompt,
    scheduleTaskBoardContinueWake,
    runAdmittedTurn(request: Parameters<typeof runAdmittedTurn>[0]) {
      return runAdmittedTurn(request, bindAdmittedTurnHost());
    },
  },
  delivery: {
    confirmPendingTurnDelivery,
    buildReplyPayloads,
    completeReplyDelivery,
    prepareVisibleDelivery(
      config: OpenBotConfig,
      request: Omit<
        Parameters<typeof prepareVisibleDelivery>[0],
        "resolvePersistRoot" | "evaluateAcceptance"
      > & { workspaceDir?: string },
    ) {
      return prepareVisibleDelivery({
        ...request,
        evaluateAcceptance: () => evaluateBoundTaskAcceptance(request),
        resolvePersistRoot: (agentId) =>
          path.join(resolveAgentDir(config, agentId), TASK_OUTCOME_STORE_DIRNAME),
      });
    },
  },
};
