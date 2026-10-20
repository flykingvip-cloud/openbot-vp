/**
 * M0 conversation-evaluation record (v3.1).
 * Passive bypass only: not a DiagnosticRun and not a Diagnosis Job.
 */

export const CONVERSATION_EVALUATION_RULE_SET_ID = "conversation-evaluation-m0";
export const CONVERSATION_EVALUATION_RULE_VERSION = "m0.v3.1";

export const ENTRYPOINTS = ["gateway-chat", "collab-bot", "subagent", "cli"] as const;
export type ConversationEntrypoint = (typeof ENTRYPOINTS)[number];

export type LinkQuality = "strong" | "weak";

export type ExecutionVerdict = "completed" | "aborted" | "timed_out" | "errored" | "unknown";
export type UsabilityVerdict = "usable" | "degraded" | "blocked" | "unassessed";
export type CorrectnessVerdict = "pass" | "weak" | "fail" | "unassessed";
export type FailureAttribution =
  | "model"
  | "tool"
  | "sandbox"
  | "orchestration"
  | "permission"
  | "config"
  | "external"
  | "none"
  | "unknown";

export type AssessmentStatus = "pending" | "assessed" | "unassessed" | "failed_to_assess";

export type UnassessedReason = "no_signal" | "insufficient_evidence" | "out_of_scope" | "rule_gap";

export type FirstVisibleKind = "tool" | "model" | "other";

/** 0 is a real measurement. null means not collected. "n/a" means not applicable. */
export type EfficiencyValue = number | "n/a" | null;

export type ClockSource = "chat.dispatch_started" | "lifecycle_start";

export type ConversationEvaluationRecord = {
  tenantId: string;
  conversationId: string;
  runId: string;
  eventId: string;
  /** Omitted when production has no attempt. Never null. */
  attempt?: number;
  agentId: string | null;
  modelId?: string;
  linkQuality: LinkQuality;
  entrypoint: ConversationEntrypoint;
  roundId?: string;
  execution: ExecutionVerdict;
  usability: UsabilityVerdict;
  correctness: CorrectnessVerdict;
  correctnessReason?: UnassessedReason;
  failureAttribution: FailureAttribution;
  assessmentStatus: AssessmentStatus;
  unassessedReason?: UnassessedReason;
  failureCode?: string;
  ruleSetId: string;
  ruleVersion: string;
  evidenceRefs: string[];
  totalMs: number | null;
  modelFirstTokenMs: EfficiencyValue;
  ttftMs: EfficiencyValue;
  firstVisibleKind?: FirstVisibleKind;
  ttftAlgorithm?: string;
  llmMs: number | null;
  toolMs: EfficiencyValue;
  toolMsAlgorithm?: "sum_of_spans.v1";
  compileMs: EfficiencyValue;
  dockerMs: "n/a";
  startupMode: "unknown";
  startedAt: string | null;
  endedAt: string | null;
  observedAt: string;
  assessedAt: string | null;
  conflictFlag?: boolean;
  recordKind: "pending" | "terminal" | "reassess";
  supersedesEventId?: string;
  t0Source?: ClockSource;
};

export function isTerminalAssessment(status: AssessmentStatus): boolean {
  return status === "assessed" || status === "unassessed" || status === "failed_to_assess";
}
