/**
 * @openbot/aor-sdk-node
 *
 * Node SDK for the Agent Orchestration Runtime. Describe a task; AOR parses,
 * selects a model, executes it on OpenBot, and evaluates the result.
 */
export * from "./client.js";
export * from "./probes.js";
export * from "./coding-evaluator.js";
export * from "./bench.js";
export * from "./live-coding.js";
export * from "./workspace-objective.js";

export const AOR_SDK_NODE_VERSION = "0.1.0";
