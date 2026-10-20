/**
 * Phase 0 execution-router contracts.
 *
 * Gap analysis vs `@openbot/toolkit` Phase 1:
 * - Toolkit `ExecutionReceipt` is a per-tool receipt (toolId/operation/status).
 *   Its JSON schema is `additionalProperties: false`, so it cannot carry run
 *   stages, Skill/Tool counts, or TTFT without a breaking schema change.
 * - This module re-exports that type and composes it. It does not declare a
 *   second `ExecutionReceipt` shape.
 * - TaskEnvelope / RoutingDecision / SkillCandidate / ToolCandidate /
 *   NormalizedToolResult / RoutingReasonCode do not exist in toolkit Phase 1.
 */

export type { ExecutionReceipt, ToolEvidence, ToolStatus } from "../contracts.js";
export { startReceipt, completeReceipt, failReceipt } from "../receipt.js";

export const EXECUTION_STAGES = [
  "inbound_accepted",
  "skill_snapshot_ready",
  "tool_set_ready",
  "system_prompt_ready",
  "model_started",
  "first_token",
  "run_completed",
] as const;

export type ExecutionStage = (typeof EXECUTION_STAGES)[number];

export const EXECUTION_EVENTS = {
  TASK_ENVELOPE_CREATED: "task_envelope_created",
  SKILL_CANDIDATES_RETRIEVED: "skill_candidates_retrieved",
  TOOL_CANDIDATES_RETRIEVED: "tool_candidates_retrieved",
  TOOL_SCHEMA_EXPOSED: "tool_schema_exposed",
} as const;

export type ExecutionEventName = (typeof EXECUTION_EVENTS)[keyof typeof EXECUTION_EVENTS];

export const ROUTING_REASON_CODES = [
  "route_unspecified",
  "route_inbound_depth",
  "route_skill_prefix",
  "route_tool_policy",
  "route_observation_only",
] as const;

export type RoutingReasonCode = (typeof ROUTING_REASON_CODES)[number];

export type TaskEnvelope = {
  runId: string;
  sessionKeyHash?: string;
  tenantId?: string;
  agentId?: string;
  createdAt: string;
};

export type SkillCandidate = {
  name: string;
  source?: string;
  eligible: boolean;
  injected: boolean;
};

export type ToolCandidate = {
  name: string;
  constructed: boolean;
  afterPolicy: boolean;
  exposed: boolean;
};

export type RoutingDecision = {
  runId: string;
  reasons: RoutingReasonCode[];
  depth?: "chat" | "retrieve" | "act";
};

/** Counts and truncation only. Never stores raw tool output. */
export type NormalizedToolResult = {
  toolId: string;
  status: import("../contracts.js").ToolStatus;
  outputChars: number;
  truncated: boolean;
};

export type SkillBaseline = {
  eligibleCount: number;
  injectedCount: number;
  promptChars: number;
};

export type ToolBaseline = {
  constructedCount: number;
  afterPolicyCount: number;
  exposedCount: number;
  schemaChars: number;
};

export type ExecutionLatencies = {
  routePrepMs?: number;
  ttftMs?: number;
  totalMs?: number;
};

/** Privacy-safe receipt projection. Never copies evidence, error details, or side-effect bodies. */
export type ObservedToolkitReceipt = {
  receiptId: string;
  toolId: string;
  operation: string;
  status: import("../contracts.js").ToolStatus;
  startedAt: string;
  completedAt?: string;
  approvalId?: string;
  idempotencyKey?: string;
  inputDigest?: string;
  outputDigest?: string;
  evidenceCount: number;
  sideEffectCount: number;
  errorCode?: string;
};

export type ChatRunObservation = {
  envelope: TaskEnvelope;
  routing?: RoutingDecision;
  stages: Partial<Record<ExecutionStage, number>>;
  events: ExecutionEventName[];
  skillBaseline?: SkillBaseline;
  toolBaseline?: ToolBaseline;
  latencies: ExecutionLatencies;
  toolkitReceipts: ObservedToolkitReceipt[];
};

export function isRoutingReasonCode(value: string): value is RoutingReasonCode {
  return (ROUTING_REASON_CODES as readonly string[]).includes(value);
}

export function isExecutionStage(value: string): value is ExecutionStage {
  return (EXECUTION_STAGES as readonly string[]).includes(value);
}

export function createTaskEnvelope(input: {
  runId: string;
  sessionKeyHash?: string;
  tenantId?: string;
  agentId?: string;
  nowMs?: number;
}): TaskEnvelope {
  return {
    runId: input.runId,
    ...(input.sessionKeyHash ? { sessionKeyHash: input.sessionKeyHash } : {}),
    ...(input.tenantId ? { tenantId: input.tenantId } : {}),
    ...(input.agentId ? { agentId: input.agentId } : {}),
    createdAt: new Date(input.nowMs ?? Date.now()).toISOString(),
  };
}
