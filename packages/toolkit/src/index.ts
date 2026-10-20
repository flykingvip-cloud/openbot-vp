/**
 * @openbot/toolkit
 *
 * Toolkit blueprint: portable tool catalog, combinations, ToolRegistry,
 * execution-receipt helpers, and Phase 2 Policy → Approval → Receipt gating.
 */

export * from "./contracts.js";
export * from "./registry.js";
export * from "./receipt.js";
export * from "./policy.js";
export * from "./approval.js";
export * from "./gated-executor.js";
export * from "./gateway-tool-facts.js";
export {
  assertValidToolDefinition,
  assertValidExecutionReceipt,
  validateToolDefinition,
} from "./validate.js";
export {
  packageRoot,
  catalogPath,
  combinationsPath,
  toolDefinitionSchemaPath,
  executionReceiptSchemaPath,
  policyExamplePath,
} from "./paths.js";
export {
  EXECUTION_EVENTS,
  EXECUTION_STAGES,
  PHASE1_FLAGS,
  ROUTING_REASON_CODES,
  assertNoSensitiveFields,
  createExecutionObserver,
  createTaskEnvelope,
  decideShadowRoute,
  digestName,
  isExecutionStage,
  isForbiddenObservationKey,
  isMonotonicStageSequence,
  isRoutingReasonCode,
  parseShadowTaskEnvelope,
  projectShadowEvent,
  projectToolkitReceipt,
  recordShadowRouteBestEffort,
  scoreSkillCandidates,
  scoreToolCandidates,
  stageOrderIndex,
  type CatalogEntry,
  type ChatRunObservation,
  type ExecutionEventName,
  type ExecutionLatencies,
  type ExecutionObserver,
  type ExecutionObserverOptions,
  type ExecutionStage,
  type NormalizedToolResult,
  type ObservedToolkitReceipt,
  type RoutingDecision,
  type RoutingReasonCode,
  type SkillBaseline,
  type ShadowDecision,
  type ShadowRouteEvent,
  type ShadowTaskEnvelope,
  type SkillCandidate,
  type TaskEnvelope,
  type ToolBaseline,
  type ToolCandidate,
} from "./execution-router/index.js";

export const TOOLKIT_VERSION = "0.2.0";
export const TOOLKIT_PHASE = 2 as const;
