import { isCliProvider } from "../../../agents/model-selection.js";
import type { ReplyPayload } from "../../../auto-reply/types.js";
import type { EmployeeModelGateResult } from "../../../gateway/model-entitlement/employee-model-gate.js";
import type { GatewayClient } from "../../../gateway/server-methods/types.js";
import type { ModalityExecutionArtifact } from "../../../task-outcome/modality-artifact-evidence.js";
import { invokeAdmittedCandidateCli } from "./admitted-candidate-cli.js";
import { invokeAdmittedCandidateEmbedded } from "./admitted-candidate-embedded.js";
/** Legacy single admitted candidate adapter. Outer admission/fallback/finalization remain with the caller. */
import type { AgentTurnExecutionParams } from "./turn-contract.js";

export type AdmittedCandidateHost = {
  observeExecution?: (stage: "started" | "completed" | "failed" | "cancelled") => void;
  /**
   * An embedded lifecycle error inside the runner. This is one internal attempt,
   * not the candidate's execution terminal. A later successful return may still complete.
   */
  observeAttempt?: (event: { kind: "embedded_lifecycle_error" }) => void;
  assertOriginalTaskCurrent: () => void;
  assertTipBudgetAllowsModelCall: () => void;

  directlySentBlockKeys: Set<string>;
  chargeTipBudgetAfterModelCall: (usage: {
    provider: string;
    model: string;
    usage?: unknown;
  }) => void;
  notifyAgentRunStart: () => void;
  handlePartialForTyping: (payload: ReplyPayload) => Promise<string | undefined>;
  normalizeStreamingText: (payload: ReplyPayload) => {
    text?: string;
    skip: boolean;
    sanitizedEmpty?: boolean;
  };
  normalizeReplyMediaPaths: (payload: ReplyPayload) => Promise<ReplyPayload>;
  recordGrowthToolResult: (isError: boolean) => void;
  recordCommercialToolStart: (name: string) => void;
  recordModalityArtifact: (artifact: ModalityExecutionArtifact) => void;
  markAutoCompactionCompleted: () => void;
  getBootstrapWarnings: () => string[];
  setBootstrapWarnings: (warnings: string[]) => void;
  getModelGate: () => EmployeeModelGateResult | undefined;
  identity: { user?: string; domain?: GatewayClient["sessionDomain"]; platformUserId?: string };
};

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

type CandidateExecutionTerminal = "completed" | "failed" | "cancelled";

/** Model-response observation is not an execution terminal. A candidate records at most one. */
function createCandidateTerminal(host: AdmittedCandidateHost) {
  let terminal: CandidateExecutionTerminal | null = null;
  return {
    finish(stage: CandidateExecutionTerminal) {
      if (terminal) {
        return;
      }
      terminal = stage;
      host.observeExecution?.(stage);
    },
  };
}

export function createAdmittedCandidateInvoker(
  params: AgentTurnExecutionParams,
  runId: string,
  host: AdmittedCandidateHost,
) {
  return (
    provider: string,
    model: string,
    runOptions?: { allowTransientCooldownProbe?: boolean },
  ) => {
    if (isCliProvider(provider, params.followupRun.run.config)) {
      return invokeAdmittedCandidateCli({
        params,
        runId,
        provider,
        model,
        host,
        isAbortError,
        createCandidateTerminal,
      });
    }
    return invokeAdmittedCandidateEmbedded({
      params,
      runId,
      provider,
      model,
      host,
      runOptions,
      isAbortError,
      createCandidateTerminal,
    });
  };
}
