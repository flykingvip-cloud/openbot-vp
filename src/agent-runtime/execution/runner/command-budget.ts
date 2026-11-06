import type { OpenBotConfig } from "../../../config/config.js";
import {
  assertRunnerTurnBudgetAllowsModelCall,
  chargeModelCallAgainstTip,
} from "../../../task-outcome/runtime-from-runner.js";
import type { TrustedScope } from "../../../task-outcome/types.js";

/** Original per-command budget sequence; parent attribution stays in the existing store. */
export function createCommandBudget(params: {
  config: OpenBotConfig;
  agentId: string;
  runId: string;
  startedAtMs: number;
  taskId?: string;
  scope?: TrustedScope;
  parentTaskId?: string;
  parentAgentId?: string;
}) {
  let sequence = 0;
  const parent = {
    ...(params.parentTaskId?.trim() ? { parentTaskId: params.parentTaskId.trim() } : {}),
    ...(params.parentAgentId?.trim() ? { parentAgentId: params.parentAgentId.trim() } : {}),
  };
  return {
    assertAllowed() {
      if (!params.taskId || !params.scope) {
        return;
      }
      assertRunnerTurnBudgetAllowsModelCall(params.config, params.agentId, {
        taskId: params.taskId,
        scope: params.scope,
        startedAtMs: params.startedAtMs,
        ...parent,
      });
    },
    charge(input: { provider: string; model: string; usage?: unknown }) {
      if (!params.taskId || !params.scope) {
        return undefined;
      }
      sequence += 1;
      return chargeModelCallAgainstTip(params.config, params.agentId, {
        taskId: params.taskId,
        scope: params.scope,
        runId: params.runId,
        callSeq: sequence,
        ...input,
        ...parent,
      });
    },
  };
}
