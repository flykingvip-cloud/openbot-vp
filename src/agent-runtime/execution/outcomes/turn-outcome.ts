/** Legacy outcome aggregation; execution return is not acceptance or transport success. */
import type { OpenBotConfig } from "../../../config/config.js";
import { syncRobotGrowthFromOperationalMetrics } from "../../../gateway/agent-growth/operational-growth.js";
import { reportEvolutionOutcomeWriteFailure } from "../../../gateway/evolution-control/evolution-loop-log.js";
import type { CapabilityOutcomeForTurn } from "../../../gateway/model-entitlement/capability-entry-consume.js";
import type { createRunCostCollector } from "../../../observation/run-cost-collector.js";
import type { createRuntimeEvidenceObserver } from "../../../observation/runtime-evidence.js";
import type { ModalityExecutionArtifact } from "../../../task-outcome/modality-artifact-evidence.js";
import {
  recordRunnerTurnOutcome,
  type GrowthOutcomeCommitOpts,
  type RunnerTurnFailureReason,
} from "../../../task-outcome/runtime-from-runner.js";
import type { TrustedScope } from "../../../task-outcome/types.js";

export function createTurnOutcomeRecorder(params: {
  runtimeEvidence?: ReturnType<typeof createRuntimeEvidenceObserver>;
  costEvidence?: ReturnType<typeof createRunCostCollector>;
  config: OpenBotConfig;
  agentId?: string;
  isHeartbeat: boolean;
  runId: string;
  startedAtMs: number;
  abortSignal?: AbortSignal;
  readContext: () => {
    taskId?: string;
    scope?: TrustedScope;
    tenantId?: string;
    capabilityOutcome?: CapabilityOutcomeForTurn;
    budgetCharged: boolean;
  };
}) {
  const runId = params.runId;
  const growthStartedAt = params.startedAtMs;
  let growthToolTotal = 0;
  let growthToolSucceeded = 0;
  const modalityArtifacts: ModalityExecutionArtifact[] = [];
  const recordGrowthToolResult = (isError: boolean): void => {
    growthToolTotal += 1;
    if (!isError) {
      growthToolSucceeded += 1;
    }
  };
  const classifyFailureReason = (opts?: {
    aborted?: boolean;
    authzDenied?: boolean;
    languageFiltered?: boolean;
    providerFault?: boolean;
    timeout?: boolean;
    prepareFailed?: boolean;
    message?: string;
    explicit?: RunnerTurnFailureReason;
  }): RunnerTurnFailureReason => {
    if (opts?.explicit) {
      return opts.explicit;
    }
    if (opts?.aborted || params.abortSignal?.aborted) {
      return "user_cancelled";
    }
    if (opts?.authzDenied) {
      return "authz_denied";
    }
    if (opts?.languageFiltered) {
      return "user_filtered";
    }
    if (opts?.prepareFailed) {
      return "prepare_failed";
    }
    if (opts?.timeout || /timeout|ETIMEDOUT|timed out/i.test(opts?.message ?? "")) {
      return "timeout";
    }
    if (opts?.providerFault) {
      return "provider_fault";
    }
    return "run_failed";
  };

  const recordGrowthTaskOutcome = (
    success: boolean,
    opts?: GrowthOutcomeCommitOpts & {
      aborted?: boolean;
      authzDenied?: boolean;
      languageFiltered?: boolean;
      providerFault?: boolean;
      timeout?: boolean;
      prepareFailed?: boolean;
      errorMessage?: string;
    },
  ): void | Promise<void> => {
    if (params.isHeartbeat) {
      return;
    }
    const growthAgentId = params.agentId;
    if (!growthAgentId) {
      return;
    }
    const toolsTotal = growthToolTotal;
    const toolsSucceeded = growthToolSucceeded;
    const artifactsForTurn = [...modalityArtifacts];
    growthToolTotal = 0;
    growthToolSucceeded = 0;
    modalityArtifacts.length = 0;
    const context = params.readContext();
    const tenantId = context.tenantId?.trim();
    const chatOutcomeTaskId = context.taskId;
    const chatOutcomeScope = context.scope;
    const capabilityOutcomeForTurn = context.capabilityOutcome;
    const tipBudgetChargedThisTurn = context.budgetCharged;
    // askOutcome R83: requires entry taskId; never invent run:${runId} at finish.
    if (!chatOutcomeTaskId || !chatOutcomeScope) {
      reportEvolutionOutcomeWriteFailure({
        runId,
        agentId: growthAgentId,
        tenantId: tenantId ?? null,
        taskId: null,
        reason: "chat_entry_task_missing",
      });
      return;
    }
    const failureReason = !success
      ? classifyFailureReason({
          explicit: opts?.failureReason,
          aborted: opts?.aborted,
          authzDenied: opts?.authzDenied,
          languageFiltered: opts?.languageFiltered,
          providerFault: opts?.providerFault,
          timeout: opts?.timeout,
          prepareFailed: opts?.prepareFailed,
          message: opts?.errorMessage ?? opts?.failureDetail,
        })
      : undefined;
    return recordRunnerTurnOutcome(params.config, growthAgentId, {
      success,
      toolsTotal,
      toolsSucceeded,
      runId,
      taskId: chatOutcomeTaskId,
      scope: chatOutcomeScope,
      latencyMs: Math.max(0, Date.now() - growthStartedAt),
      ...(tenantId ? { tenantId } : {}),
      ...(capabilityOutcomeForTurn ? { capabilityOutcome: capabilityOutcomeForTurn } : {}),
      ...(artifactsForTurn.length > 0 ? { modalityArtifacts: artifactsForTurn } : {}),
      ...(failureReason ? { failureReason } : {}),
      ...(opts?.failureDetail ? { failureDetail: opts.failureDetail } : {}),
      ...(opts?.acceptance ? { acceptance: opts.acceptance } : {}),
      ...(opts?.delivery ? { delivery: opts.delivery } : {}),
      ...(opts?.deliveryId ? { deliveryId: opts.deliveryId } : {}),
      ...(opts?.acceptanceEvidence ? { acceptanceEvidence: opts.acceptanceEvidence } : {}),
      ...(opts?.processPlaceholder ? { processPlaceholder: true } : {}),
      ...(opts?.allowRetry !== undefined ? { allowRetry: opts.allowRetry } : {}),
      ...(opts?.adoptedAssetIds && opts.adoptedAssetIds.length > 0
        ? { adoptedAssetIds: opts.adoptedAssetIds }
        : {}),
      ...(tipBudgetChargedThisTurn || opts?.skipBudgetCharge ? { skipBudgetCharge: true } : {}),
    })
      .then(async (receipt) => {
        if (receipt?.record) {
          params.costEvidence?.bind(receipt.record);
          params.runtimeEvidence?.bind(receipt.record, {
            agentId: growthAgentId,
            provenance: "live",
          });
        }
        await syncRobotGrowthFromOperationalMetrics(params.config, growthAgentId);
      })
      .catch((error: unknown) => {
        // Evolution / TaskOutcome write must stay observable. The user-facing
        // reply path is already decided and is not rewritten here.
        reportEvolutionOutcomeWriteFailure({
          runId,
          agentId: growthAgentId,
          tenantId: tenantId ?? null,
          taskId: chatOutcomeTaskId ?? null,
          reason: error instanceof Error ? error.message : "evolution_outcome_write_failed",
        });
      });
  };
  return {
    recordToolResult: recordGrowthToolResult,
    recordArtifact: (artifact: ModalityExecutionArtifact) => {
      modalityArtifacts.push(artifact);
    },
    hasToolResults: () => growthToolTotal > 0,
    commit: recordGrowthTaskOutcome,
  };
}
