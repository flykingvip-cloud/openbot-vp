/**
 * Plugin Hook Runner — driver
 *
 * Composes the per-family runners into the public hook-runner API. This is
 * the only file that imports from every event-family module; family files
 * themselves must not import from each other (enforced by the
 * `hooks-event-family-isolation` architecture-manifest rule).
 */

import type { PluginRegistry } from "../registry.js";
import type { PluginHookName } from "../types.js";
import {
  makeRunAfterCompaction,
  makeRunAgentEnd,
  makeRunBeforeAgentStart,
  makeRunBeforeCompaction,
  makeRunBeforeModelResolve,
  makeRunBeforePromptBuild,
  makeRunBeforeReset,
  makeRunLlmInput,
  makeRunLlmOutput,
} from "./agent-events.js";
import { makeRunGatewayStart, makeRunGatewayStop } from "./gateway-lifecycle-events.js";
import {
  makeRunBeforeMessageWrite,
  makeRunMessageReceived,
  makeRunMessageSending,
  makeRunMessageSent,
} from "./message-events.js";
import type { HookRunnerOptions } from "./runner-types.js";
import { makeRunSessionEnd, makeRunSessionStart } from "./session-events.js";
import {
  makeRunSubagentDeliveryTarget,
  makeRunSubagentEnded,
  makeRunSubagentSpawned,
  makeRunSubagentSpawning,
} from "./subagent-events.js";
import {
  makeRunAfterToolCall,
  makeRunBeforeToolCall,
  makeRunToolResultPersist,
} from "./tool-events.js";

/**
 * Create a hook runner for a specific registry.
 */
export function createHookRunner(registry: PluginRegistry, options: HookRunnerOptions = {}) {
  const logger = options.logger;
  const catchErrors = options.catchErrors ?? true;

  const deps = { registry, catchErrors, logger };

  // =========================================================================
  // Utility (lives here because it inspects the registry directly and is not
  // event-specific)
  // =========================================================================

  /**
   * Check if any hooks are registered for a given hook name.
   */
  function hasHooks(hookName: PluginHookName): boolean {
    return registry.typedHooks.some((h) => h.hookName === hookName);
  }

  /**
   * Get count of registered hooks for a given hook name.
   */
  function getHookCount(hookName: PluginHookName): number {
    return registry.typedHooks.filter((h) => h.hookName === hookName).length;
  }

  return {
    // Agent hooks
    runBeforeModelResolve: makeRunBeforeModelResolve(deps),
    runBeforePromptBuild: makeRunBeforePromptBuild(deps),
    runBeforeAgentStart: makeRunBeforeAgentStart(deps),
    runLlmInput: makeRunLlmInput(deps),
    runLlmOutput: makeRunLlmOutput(deps),
    runAgentEnd: makeRunAgentEnd(deps),
    runBeforeCompaction: makeRunBeforeCompaction(deps),
    runAfterCompaction: makeRunAfterCompaction(deps),
    runBeforeReset: makeRunBeforeReset(deps),
    // Message hooks
    runMessageReceived: makeRunMessageReceived(deps),
    runMessageSending: makeRunMessageSending(deps),
    runMessageSent: makeRunMessageSent(deps),
    // Tool hooks
    runBeforeToolCall: makeRunBeforeToolCall(deps),
    runAfterToolCall: makeRunAfterToolCall(deps),
    runToolResultPersist: makeRunToolResultPersist(deps),
    // Message write hooks
    runBeforeMessageWrite: makeRunBeforeMessageWrite(deps),
    // Session hooks
    runSessionStart: makeRunSessionStart(deps),
    runSessionEnd: makeRunSessionEnd(deps),
    runSubagentSpawning: makeRunSubagentSpawning(deps),
    runSubagentDeliveryTarget: makeRunSubagentDeliveryTarget(deps),
    runSubagentSpawned: makeRunSubagentSpawned(deps),
    runSubagentEnded: makeRunSubagentEnded(deps),
    // Gateway hooks
    runGatewayStart: makeRunGatewayStart(deps),
    runGatewayStop: makeRunGatewayStop(deps),
    // Utility
    hasHooks,
    getHookCount,
  };
}
