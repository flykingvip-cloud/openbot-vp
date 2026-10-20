/**
 * @openbot/aor-core
 *
 * Backend-agnostic core of the Agent Orchestration Runtime: task taxonomy,
 * capability registry, model selection, evaluation, feedback, and the
 * ExecutionBackend abstraction. Zero runtime dependencies; no OpenBot internals.
 */
export * from "./types.js";
export * from "./backend.js";
export * from "./task-types.js";
export * from "./capabilities.js";
export * from "./parser.js";
export * from "./selector.js";
export * from "./evaluator.js";
export * from "./feedback.js";
export * from "./catalog.js";
export * from "./planner.js";
export * from "./orchestrator.js";
export * from "./cost.js";
export * from "./billing-bridge.js";
export * from "./tool-invoker.js";
export * from "./openbot-skills.js";
export * from "./bandit.js";
export * from "./bandit-persistence.js";
export * from "./audit.js";
export * from "./optimization-report.js";

export const AOR_CORE_VERSION = "0.1.0";
