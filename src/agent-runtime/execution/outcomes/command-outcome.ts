import type { OpenBotConfig } from "../../../config/config.js";
import {
  recordRunnerTurnOutcome,
  type ModelCallCloseoutLink,
  type RunnerTurnFailureReason,
} from "../../../task-outcome/runtime-from-runner.js";
import type { Entrypoint, TrustedScope } from "../../../task-outcome/types.js";
import type { CommandDeliveryReceipt } from "../../contracts/delivery.js";
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
      costUsd: tipBudgetCostUsd,
      deliveryReceipt,
      modelCallLinks,
    } = params.readContext();
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
        ...(tipBudgetChargedThisTurn ? { skipBudgetCharge: true } : {}),
        ...(!tipBudgetChargedThisTurn && tipBudgetCostUsd != null
          ? { costUsd: tipBudgetCostUsd }
          : {}),
        ...(success
          ? {}
          : {
              failureReason: agentOutcomeFailureReason ?? ("run_failed" as const),
              ...(agentOutcomeFailureDetail ? { failureDetail: agentOutcomeFailureDetail } : {}),
            }),
        ...(modelCallLinks && modelCallLinks.length > 0 ? { modelCallLinks } : {}),
      });
    } catch (err) {
      console.error(
        `[agent] unified recordRunnerTurnOutcome failed for ${params.entrypoint}: ${String(err)}`,
      );
    }
  };
}
