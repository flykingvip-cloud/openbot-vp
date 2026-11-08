import type { OpenBotConfig } from "../../../config/config.js";
import {
  assertRunnerTurnBudgetAllowsModelCall,
  chargeModelCallAgainstTip,
  TaskBudgetExceededError,
  usageRetainedForCandidateCharge,
  type ModelCallCloseoutLink,
} from "../../../task-outcome/runtime-from-runner.js";
import type { TrustedScope } from "../../../task-outcome/types.js";
import type { EmbeddedPiRunResult } from "./embedded-result.js";

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
  let charged = false;
  let costUsd: number | undefined;
  const modelCallLinks: ModelCallCloseoutLink[] = [];
  const parent = {
    ...(params.parentTaskId?.trim() ? { parentTaskId: params.parentTaskId.trim() } : {}),
    ...(params.parentAgentId?.trim() ? { parentAgentId: params.parentAgentId.trim() } : {}),
  };
  const budget = {
    get charged() {
      return charged;
    },
    get costUsd() {
      return costUsd;
    },
    get modelCallLinks() {
      return modelCallLinks;
    },
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
      const receipt = chargeModelCallAgainstTip(params.config, params.agentId, {
        taskId: params.taskId,
        scope: params.scope,
        runId: params.runId,
        callSeq: sequence,
        ...input,
        ...parent,
      });
      if (receipt.modelCallLink) {
        modelCallLinks.push(receipt.modelCallLink);
      }
      return receipt;
    },
    async runCandidate(input: {
      provider: string;
      model: string;
      run: () => Promise<EmbeddedPiRunResult>;
    }) {
      budget.assertAllowed();
      try {
        const result = await input.run();
        const receipt = budget.charge({
          provider: input.provider,
          model: input.model,
          usage: result.meta?.agentMeta?.usage,
        });
        if (receipt) {
          charged = true;
          if (receipt.evidence === "known" && receipt.costUsd && receipt.costUsd > 0) {
            costUsd = (costUsd ?? 0) + receipt.costUsd;
          }
        }
        return result;
      } catch (error) {
        if (!(error instanceof TaskBudgetExceededError)) {
          try {
            const receipt = budget.charge({
              provider: input.provider,
              model: input.model,
              usage: usageRetainedForCandidateCharge(undefined, error),
            });
            if (receipt) {
              charged = true;
            }
          } catch (chargeError) {
            if (chargeError instanceof TaskBudgetExceededError) {
              throw chargeError;
            }
          }
        }
        throw error;
      }
    },
  };
  return budget;
}
