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

function errorName(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined;
}

/** One candidate charge. Unknown means a commit was attempted and its result is not known. */
export type CommandCandidateChargeState = "not_attempted" | "attempted_unknown" | "committed";

/**
 * Closeout view of a command budget.
 * An unknown commit skips another spend and does not pass a guessed amount.
 * A charge that never started may still carry one explicit fallback amount.
 */
export function settleCommandBudgetForCloseout(
  budget: { chargeState: CommandCandidateChargeState; costUsd?: number },
  fallback?: { costUsd?: number },
): { chargeState: CommandCandidateChargeState; budgetCharged: boolean; costUsd?: number } {
  if (budget.chargeState === "attempted_unknown") {
    return { chargeState: "attempted_unknown", budgetCharged: true };
  }
  if (budget.chargeState === "committed") {
    return {
      chargeState: "committed",
      budgetCharged: true,
      ...(budget.costUsd != null ? { costUsd: budget.costUsd } : {}),
    };
  }
  return {
    chargeState: "not_attempted",
    budgetCharged: false,
    ...(fallback?.costUsd != null ? { costUsd: fallback.costUsd } : {}),
  };
}

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
  let chargeState: CommandCandidateChargeState = "not_attempted";
  let charged = false;
  let costUsd: number | undefined;
  const modelCallLinks: ModelCallCloseoutLink[] = [];
  const parent = {
    ...(params.parentTaskId?.trim() ? { parentTaskId: params.parentTaskId.trim() } : {}),
    ...(params.parentAgentId?.trim() ? { parentAgentId: params.parentAgentId.trim() } : {}),
  };
  const budget = {
    get chargeState() {
      return chargeState;
    },
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
      if (receipt?.modelCallLink) {
        modelCallLinks.push(receipt.modelCallLink);
      }
      return receipt;
    },
    /**
     * At most one charge attempt per candidate.
     * The latch is set before `charge`, so a commit that then throws cannot open a second command.
     */
    chargeCandidateOnce(input: { provider: string; model: string; usage?: unknown }) {
      if (chargeState !== "not_attempted") {
        return;
      }
      if (!params.taskId || !params.scope) {
        return;
      }
      chargeState = "attempted_unknown";
      const receipt = budget.charge(input);
      if (!receipt) {
        chargeState = "not_attempted";
        return;
      }
      chargeState = "committed";
      charged = true;
      if (receipt.evidence === "known" && receipt.costUsd && receipt.costUsd > 0) {
        costUsd = (costUsd ?? 0) + receipt.costUsd;
      }
    },
    async runCandidate(input: {
      provider: string;
      model: string;
      run: () => Promise<EmbeddedPiRunResult>;
    }) {
      budget.assertAllowed();
      try {
        const result = await input.run();
        budget.chargeCandidateOnce({
          provider: input.provider,
          model: input.model,
          usage: result.meta?.agentMeta?.usage,
        });
        return result;
      } catch (error) {
        if (!(error instanceof TaskBudgetExceededError) && errorName(error) !== "AbortError") {
          try {
            budget.chargeCandidateOnce({
              provider: input.provider,
              model: input.model,
              usage: usageRetainedForCandidateCharge(undefined, error),
            });
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
