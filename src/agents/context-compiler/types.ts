import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { InboundDepth } from "../../auto-reply/reply/inbound-depth.js";

export type ContextLane = InboundDepth;

export type ContextUnitKind = "plain_turn" | "tool_execution_turn" | "current_execution_turn";

export type ContextUnit = {
  kind: ContextUnitKind;
  messages: AgentMessage[];
};

export type MemoryProfileEntry = {
  key: string;
  value: string;
  scope: "user";
  source: "conversation";
  sourceMessageId: string;
  updatedAt: string;
  version: number;
  previousValue?: string;
};

export type ContextCandidates = {
  userProfile: MemoryProfileEntry[];
  task: string;
  memory: string;
  evidence: string;
};

export type ContextDropReason = {
  type: "recent_turn" | "user_profile" | "task" | "memory" | "evidence" | "capsule";
  reason: "budget" | "window" | "empty" | "low_priority" | "shrunk";
  priority: number;
};

export type ContextRecallSafety = {
  currentTurnPreserved: boolean;
  activeTaskPreserved: boolean;
  toolTransactionIntegrity: boolean;
  requiredMemoryPreserved: boolean;
};

export type ContextCompileTelemetry = {
  runId?: string;
  lane: ContextLane;
  preCompileMessageCount: number;
  postCompileMessageCount: number;
  preCompileEstimatedTokens: number;
  postCompileEstimatedTokens: number;
  admissionBudgetTokens: number;
  targetBudgetTokens: number;
  unitCountBefore: number;
  unitCountAfter: number;
  contextDropReasons: ContextDropReason[];
  recallSafety: ContextRecallSafety;
  compileMs: number;
  providerMessageCount?: number;
  providerBoundaryMatch?: boolean;
};

export type CollabCompileStrategyParams = {
  /** When true, use group-specific window + retain member conclusions on compress. */
  enabled: boolean;
  /** Optional override for recent-unit window (group strategy default applied by compile). */
  maxRecentTurns?: number;
  retainMemberConclusions?: boolean;
};

export type CompileContextParams = {
  messages: AgentMessage[];
  lane: ContextLane;
  candidates?: ContextCandidates;
  maxRecentTurns?: number;
  /** Model context window. Lane targets scale from this and stay at the lane floor when small or omitted. */
  contextWindowTokens?: number;
  runId?: string;
  /**
   * Expert #3: collaboration-specific compile strategy (default unset/off).
   * Does not change global lane budgets when disabled or omitted.
   */
  collabCompileStrategy?: CollabCompileStrategyParams;
};

export type CompileContextResult = {
  messages: AgentMessage[];
  telemetry: ContextCompileTelemetry;
};
