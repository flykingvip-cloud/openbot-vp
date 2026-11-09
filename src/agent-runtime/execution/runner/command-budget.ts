import type { OpenBotConfig } from "../../../config/config.js";
import type { BudgetCommandDisposition } from "../../../executor-evidence/association.js";
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

/**
 * One candidate's charge result.
 * `attempted_unknown` means the call was made and no receipt came back.
 * A non-empty receipt is classified from its disposition, not treated as committed.
 */
export type { CommandCandidateChargeState } from "../../contracts/execution.js";
import type { CommandCandidateChargeState } from "../../contracts/execution.js";

export type CommandCandidateChargeRecord = {
  callSeq: number | null;
  state: CommandCandidateChargeState;
  disposition?: BudgetCommandDisposition;
  reason: string;
};

/**
 * Closeout view of a command budget.
 * Anything other than a clean commit skips another spend and does not pass a guessed amount.
 * The returned state is the aggregate reason, not a claim that every receipt committed.
 */
export function settleCommandBudgetForCloseout(
  budget: {
    chargeState: CommandCandidateChargeState;
    costUsd?: number;
    chargeReasons?: readonly string[];
  },
  fallback?: { costUsd?: number },
): {
  chargeState: CommandCandidateChargeState;
  budgetCharged: boolean;
  costUsd?: number;
  reasons: readonly string[];
} {
  const reasons = budget.chargeReasons ?? [];
  if (budget.chargeState === "not_attempted") {
    return {
      chargeState: "not_attempted",
      budgetCharged: false,
      reasons,
      ...(fallback?.costUsd != null ? { costUsd: fallback.costUsd } : {}),
    };
  }
  if (budget.chargeState === "committed") {
    return {
      chargeState: "committed",
      budgetCharged: true,
      reasons,
      ...(budget.costUsd != null ? { costUsd: budget.costUsd } : {}),
    };
  }
  return { chargeState: budget.chargeState, budgetCharged: true, reasons };
}

function stateFromDisposition(
  disposition: BudgetCommandDisposition | undefined,
): CommandCandidateChargeState {
  switch (disposition) {
    case "applied":
    case "replayed":
      return "committed";
    case "conflict":
      return "conflict";
    case "evidence_missing":
      return "evidence_missing";
    case "absent":
      return "absent";
    case "no_effect":
      return "no_effect";
    default:
      return "attempted_unknown";
  }
}

function aggregateChargeState(
  records: readonly CommandCandidateChargeRecord[],
): CommandCandidateChargeState {
  if (records.length === 0) {
    return "not_attempted";
  }
  const rank: CommandCandidateChargeState[] = [
    "attempted_unknown",
    "conflict",
    "evidence_missing",
    "absent",
    "no_effect",
  ];
  for (const state of rank) {
    if (records.some((record) => record.state === state)) {
      return state;
    }
  }
  if (records.every((record) => record.state === "committed")) {
    return "committed";
  }
  return "attempted_unknown";
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
  let charged = false;
  let costUsd: number | undefined;
  const chargeRecords: CommandCandidateChargeRecord[] = [];
  const modelCallLinks: ModelCallCloseoutLink[] = [];
  const parent = {
    ...(params.parentTaskId?.trim() ? { parentTaskId: params.parentTaskId.trim() } : {}),
    ...(params.parentAgentId?.trim() ? { parentAgentId: params.parentAgentId.trim() } : {}),
  };
  const budget = {
    get chargeState() {
      return aggregateChargeState(chargeRecords);
    },
    get chargeRecords() {
      return chargeRecords;
    },
    get chargeReasons() {
      return chargeRecords.map(
        (record) =>
          `${record.callSeq ?? "none"}:${record.state}:${record.disposition ?? record.reason}`,
      );
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
     * Record one charge attempt. The caller supplies the per-candidate latch.
     * A throw leaves the attempt unknown and does not retry inside this call.
     */
    recordChargeAttempt(input: { provider: string; model: string; usage?: unknown }) {
      if (!params.taskId || !params.scope) {
        return;
      }
      const record: CommandCandidateChargeRecord = {
        callSeq: null,
        state: "attempted_unknown",
        reason: "charge_not_returned",
      };
      chargeRecords.push(record);
      let receipt: ReturnType<typeof budget.charge>;
      try {
        receipt = budget.charge(input);
      } catch (error) {
        record.callSeq = sequence;
        record.reason = error instanceof Error ? error.message : "charge_threw";
        throw error;
      }
      if (!receipt) {
        chargeRecords.pop();
        return;
      }
      record.callSeq = sequence;
      record.disposition = receipt.budgetCommand.disposition;
      record.state = stateFromDisposition(record.disposition);
      record.reason = record.disposition ?? "disposition_missing";
      if (record.state === "committed") {
        charged = true;
        if (receipt.evidence === "known" && receipt.costUsd && receipt.costUsd > 0) {
          costUsd = (costUsd ?? 0) + receipt.costUsd;
        }
      }
    },
    async runCandidate(input: {
      provider: string;
      model: string;
      run: () => Promise<EmbeddedPiRunResult>;
    }) {
      budget.assertAllowed();
      // The latch belongs to this candidate. The next candidate on this command gets a new one.
      let attempted = false;
      const chargeThisCandidateOnce = (usage?: unknown) => {
        if (attempted) {
          return;
        }
        attempted = true;
        budget.recordChargeAttempt({
          provider: input.provider,
          model: input.model,
          usage,
        });
      };
      try {
        const result = await input.run();
        chargeThisCandidateOnce(result.meta?.agentMeta?.usage);
        return result;
      } catch (error) {
        if (!(error instanceof TaskBudgetExceededError) && errorName(error) !== "AbortError") {
          try {
            chargeThisCandidateOnce(usageRetainedForCandidateCharge(undefined, error));
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
