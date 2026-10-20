/**
 * Task Progress Ledger contract.
 *
 * Events are the immutable audit source. Ledger state is a fold. Projection is read-only.
 * LLM text cannot write status.
 */

export const PROGRESS_LEDGER_SCHEMA_VERSION = 1 as const;
export const DEFAULT_STALE_AFTER_MS = 72 * 60 * 60 * 1000;

export type EvidenceType =
  | "tool_result"
  | "data_snapshot"
  | "artifact"
  | "external_receipt"
  | "validation_result"
  | "human_confirmation"
  | "system_observation";

export type ForbiddenEvidenceType =
  | "assistant_text"
  | "model_claim"
  | "planner_claim"
  | "llm_self_report"
  | "run_summary_guess";

export type EvidenceVerification = "passed" | "failed" | "skipped";

export type ProgressEvidence = {
  type: EvidenceType;
  atMs: number;
  source?: string;
  recordCount?: number;
  ruleVersion?: string;
  verification?: EvidenceVerification;
  artifactRef?: string;
  receiptId?: string;
  recipient?: string;
  note?: string;
};

export type BlockingReason =
  | "blocked_user"
  | "blocked_authorization"
  | "blocked_external"
  | "blocked_data"
  | "blocked_policy"
  | "blocked_system";

export type BlockingGateType =
  | "user_confirmation"
  | "authorization"
  | "external"
  | "data"
  | "policy"
  | "system";

export type BlockingGate = {
  type: BlockingGateType;
  reason: BlockingReason;
  question: string;
  stepId?: string;
};

export type AcceptanceStatus = "unknown" | "met" | "unmet" | "blocked";

export type AcceptanceItem = {
  id: string;
  text: string;
  required: boolean;
  status: AcceptanceStatus;
  evidence: ProgressEvidence[];
  satisfiedByStepIds: string[];
  updatedAtMs: number;
};

export type StepStatus =
  | "pending"
  | "in_progress"
  | "executed"
  | "verified"
  | "completed"
  | "failed"
  | "blocked";

export type ExecutionStep = {
  id: string;
  planVersion: number;
  title: string;
  status: StepStatus;
  executed: boolean;
  verified: boolean;
  acceptanceIds: string[];
  startedAtMs?: number;
  completedAtMs?: number;
  evidence: ProgressEvidence[];
  failure?: { code: string; message: string };
  blocking?: { reason: BlockingReason; question?: string };
  retired: boolean;
};

export type ReplanRecord = {
  id: string;
  atMs: number;
  fromVersion: number;
  toVersion: number;
  reason: string;
  triggeredBy: "runtime" | "human" | "system";
  addedStepIds: string[];
  retiredStepIds: string[];
};

export type ExecutionEventType =
  | "PLAN_SEEDED"
  | "STEP_STARTED"
  | "TOOL_SUCCEEDED"
  | "TOOL_FAILED"
  | "EVIDENCE_RECORDED"
  | "VALIDATION_PASSED"
  | "VALIDATION_FAILED"
  | "ACCEPTANCE_MET"
  | "ACCEPTANCE_UNMET"
  | "STEP_EXECUTED"
  | "STEP_VERIFIED"
  | "STEP_COMPLETED"
  | "STEP_FAILED"
  | "STEP_BLOCKED"
  | "STEP_UNBLOCKED"
  | "GATE_RAISED"
  | "GATE_CLEARED"
  | "REPLAN_APPENDED"
  | "MEANINGFUL_PROGRESS";

export type EventActor = "runtime" | "validator" | "human" | "system";

export type SeedAcceptanceDraft = {
  id: string;
  text: string;
  required?: boolean;
  satisfiedByStepIds?: string[];
};

export type SeedStepDraft = {
  id: string;
  title: string;
  acceptanceIds?: string[];
};

export type ExecutionEventPayload = {
  goal?: string;
  title?: string;
  staleAfterMs?: number;
  acceptance?: SeedAcceptanceDraft[];
  steps?: SeedStepDraft[];
  evidence?: ProgressEvidence | ProgressEvidence[];
  reason?: string;
  question?: string;
  gate?: BlockingGate;
  failure?: { code: string; message: string };
  fromVersion?: number;
  toVersion?: number;
  addedSteps?: SeedStepDraft[];
  retiredStepIds?: string[];
  replanReason?: string;
  triggeredBy?: ReplanRecord["triggeredBy"];
  toolName?: string;
  recordCount?: number;
  /** Forbidden: LLM / callers must not write status directly (I1). */
  status?: unknown;
};

export type ExecutionEvent = {
  id: string;
  atMs: number;
  type: ExecutionEventType;
  taskId: string;
  stepId?: string;
  acceptanceId?: string;
  planVersion: number;
  payload: ExecutionEventPayload;
  actor: EventActor;
};

export type ExecutionLedger = {
  schemaVersion: typeof PROGRESS_LEDGER_SCHEMA_VERSION;
  taskId: string;
  goal: string;
  lastUpdatedAtMs: number;
  lastMeaningfulChangeAtMs: number;
  staleAfterMs: number;
  acceptance: AcceptanceItem[];
  steps: ExecutionStep[];
  replans: ReplanRecord[];
  currentPlanVersion: number;
  completed: boolean;
  currentBlocking?: BlockingGate;
};

export type TurnContractMode = "deliver" | "ask" | "wait" | "quiet" | "repair";

export type TurnContractSnapshot = {
  mode: TurnContractMode;
  blockingGate?: BlockingGate | null;
  openWork?: string[];
};

export type AcceptanceProgress = { met: number; total: number };

export type ExecutionProgress = {
  completed: number;
  total: number;
  inProgress: number;
  remaining: number;
};

export type ProgressNodeTone = "done" | "current" | "pending" | "failed" | "blocked";

export type ProgressNode = {
  id: string;
  title: string;
  tone: ProgressNodeTone;
};

export type ProgressView = {
  projectionKind: "canonical";
  taskId: string;
  goal: string;
  headline: string;
  focus: string;
  acceptanceProgress: AcceptanceProgress;
  executionProgress: ExecutionProgress;
  mode: TurnContractMode;
  blockingGate?: BlockingGate;
  stale: boolean;
  lastMeaningfulChangeAtMs: number;
  lastUpdatedAtMs: number;
  emitToChat: boolean;
  emitNotification: boolean;
  currentStepId?: string;
  nodes: ProgressNode[];
  collapsedSummary?: { done: number; current: number; remaining: number };
  taskCompleted: boolean;
  planVersion: number;
  replans: ReplanHistoryItem[];
};

export type ReplanHistoryItem = {
  atMs: number;
  fromVersion: number;
  toVersion: number;
  reason: string;
  triggeredBy: ReplanRecord["triggeredBy"];
};

export type ReplanProposal = {
  taskId: string;
  reason: string;
  addedSteps: SeedStepDraft[];
  retiredStepIds?: string[];
  /** Who drafted the titles. Never becomes event.actor. */
  proposedBy?: "model" | "human" | "runtime";
};

export type LedgerInvariantId = "I1" | "I2" | "I3" | "I4" | "I5" | "I6" | "I7" | "I8";

export type LedgerInvariantViolation = {
  id: LedgerInvariantId;
  message: string;
};
