import type { OpenBotConfig } from "../../../config/config.js";
import {
  recordRunnerTurnOutcome,
  type ModelCallCloseoutLink,
  type RunnerTurnFailureReason,
} from "../../../task-outcome/runtime-from-runner.js";
import type { Entrypoint, TrustedScope } from "../../../task-outcome/types.js";
import type { CommandDeliveryReceipt } from "../../contracts/delivery.js";
import type { CommandCandidateChargeState } from "../runner/command-budget.js";
/** Execution outcome only; acceptance and delivery need separate evidence. */
export function createCommandOutcomeCloseout(params: {
  config: OpenBotConfig;
  agentId: string;
  runId: string;
  startedAtMs: number;
  entrypoint: Entrypoint;
  readContext: () => {
    taskId?: string;
    scope?: TrustedScope;
    success?: boolean;
    failureReason?: RunnerTurnFailureReason;
    failureDetail?: string;
    budgetCharged: boolean;
    chargeState?: CommandCandidateChargeState;
    budgetChargeReasons?: readonly string[];
    costUsd?: number;
    deliveryReceipt?: CommandDeliveryReceipt;
    modelCallLinks?: ModelCallCloseoutLink[];
  };
}) {
  let agentOutcomeCloseoutDone = false;
  return async () => {
    const {
      taskId: agentOutcomeTaskId,
      scope: agentOutcomeScope,
      success: agentOutcomeSuccess,
      failureReason: agentOutcomeFailureReason,
      failureDetail: agentOutcomeFailureDetail,
      budgetCharged: tipBudgetChargedThisTurn,
      chargeState,
      budgetChargeReasons,
      costUsd: tipBudgetCostUsd,
      deliveryReceipt,
      modelCallLinks,
    } = params.readContext();
    const settledCharge = chargeState ?? (tipBudgetChargedThisTurn ? "committed" : "not_attempted");
    const skipBudgetCharge = settledCharge !== "not_attempted";
    const closeoutCostUsd = settledCharge === "not_attempted" ? tipBudgetCostUsd : undefined;
    if (agentOutcomeCloseoutDone || !params.entrypoint) {
      return;
    }
    if (!agentOutcomeTaskId || !agentOutcomeScope) {
      return;
    }
    if (agentOutcomeSuccess === undefined && agentOutcomeFailureReason === undefined) {
      return;
    }
    agentOutcomeCloseoutDone = true;
    const success = agentOutcomeSuccess === true;
    try {
      await recordRunnerTurnOutcome(params.config, params.agentId, {
        success,
        runId: params.runId,
        taskId: agentOutcomeTaskId,
        scope: agentOutcomeScope,
        entrypoint: params.entrypoint,
        ...(deliveryReceipt
          ? { delivery: { status: deliveryReceipt.status }, deliveryId: deliveryReceipt.deliveryId }
          : {}),
        latencyMs: Math.max(0, Date.now() - params.startedAtMs),
        ...(skipBudgetCharge ? { skipBudgetCharge: true } : {}),
        ...(!skipBudgetCharge && closeoutCostUsd != null ? { costUsd: closeoutCostUsd } : {}),
        ...(success
          ? {}
          : {
              failureReason: agentOutcomeFailureReason ?? ("run_failed" as const),
              ...(agentOutcomeFailureDetail ? { failureDetail: agentOutcomeFailureDetail } : {}),
            }),
        ...(modelCallLinks && modelCallLinks.length > 0 ? { modelCallLinks } : {}),
        ...(budgetChargeReasons && budgetChargeReasons.length > 0 ? { budgetChargeReasons } : {}),
      });
    } catch (err) {
      console.error(
        `[agent] unified recordRunnerTurnOutcome failed for ${params.entrypoint}: ${String(err)}`,
      );
    }
  };
}
