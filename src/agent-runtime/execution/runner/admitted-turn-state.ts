import type { RuntimeFallbackAttempt } from "../../../auto-reply/reply/agent-run-credit-usage.js";
import type { CapabilityOutcomeForTurn } from "../../../gateway/model-entitlement/capability-entry-consume.js";
import type { EmployeeModelGateResult } from "../../../gateway/model-entitlement/employee-model-gate.js";
import type { EmbeddedPiRunResult } from "./embedded-result.js";

/** Mutable per-turn markers shared by attempt and recovery (single copy). */
export type AdmittedTurnLoopState = {
  didLogHeartbeatStrip: boolean;
  autoCompactionCompleted: boolean;
  commercialToolCallCount: number;
  commercialToolClasses: string[];
  bootstrapPromptWarningSignaturesSeen: string[];
  modelGate: EmployeeModelGateResult | undefined;
  capabilityOutcomeForTurn: CapabilityOutcomeForTurn | undefined;
  runResult: EmbeddedPiRunResult;
  fallbackProvider: string;
  fallbackModel: string;
  fallbackAttempts: RuntimeFallbackAttempt[];
  didResetAfterCompactionFailure: boolean;
  didRetryTransientHttpError: boolean;
  didRetrySoftEntitlement: boolean;
  tipBudgetChargedThisTurn: boolean;
};
