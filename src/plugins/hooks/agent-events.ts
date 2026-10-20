/**
 * Agent-event family runners.
 *
 * Each exported function constructs a runner closure bound to a single
 * `PluginRegistry` + runner options. The runner driver in `runner.ts`
 * composes these into the public hook-runner API.
 *
 * Family files MUST NOT import from each other; cross-family helpers go
 * through `./runner-shared.js`.
 */

import type { PluginRegistry } from "../registry.js";
import type {
  PluginHookAfterCompactionEvent,
  PluginHookAgentContext,
  PluginHookAgentEndEvent,
  PluginHookBeforeAgentStartEvent,
  PluginHookBeforeAgentStartResult,
  PluginHookBeforeCompactionEvent,
  PluginHookBeforeModelResolveEvent,
  PluginHookBeforeModelResolveResult,
  PluginHookBeforePromptBuildEvent,
  PluginHookBeforePromptBuildResult,
  PluginHookBeforeResetEvent,
  PluginHookLlmInputEvent,
  PluginHookLlmOutputEvent,
} from "../types.js";
import {
  mergeBeforeModelResolve,
  mergeBeforePromptBuild,
  runModifyingHook,
  runVoidHook,
} from "./runner-shared.js";
import type { HookRunnerLogger } from "./runner-types.js";

interface AgentEventDeps {
  registry: PluginRegistry;
  catchErrors: boolean;
  logger?: HookRunnerLogger;
}

/**
 * Run before_model_resolve hook.
 * Allows plugins to override provider/model before model resolution.
 */
export function makeRunBeforeModelResolve(deps: AgentEventDeps) {
  return async function runBeforeModelResolve(
    event: PluginHookBeforeModelResolveEvent,
    ctx: PluginHookAgentContext,
  ): Promise<PluginHookBeforeModelResolveResult | undefined> {
    return runModifyingHook<"before_model_resolve", PluginHookBeforeModelResolveResult>(
      { ...deps, hookName: "before_model_resolve" },
      event,
      ctx,
      mergeBeforeModelResolve,
    );
  };
}

/**
 * Run before_prompt_build hook.
 * Allows plugins to inject context and system prompt before prompt submission.
 */
export function makeRunBeforePromptBuild(deps: AgentEventDeps) {
  return async function runBeforePromptBuild(
    event: PluginHookBeforePromptBuildEvent,
    ctx: PluginHookAgentContext,
  ): Promise<PluginHookBeforePromptBuildResult | undefined> {
    return runModifyingHook<"before_prompt_build", PluginHookBeforePromptBuildResult>(
      { ...deps, hookName: "before_prompt_build" },
      event,
      ctx,
      mergeBeforePromptBuild,
    );
  };
}

/**
 * Run before_agent_start hook.
 * Legacy compatibility hook that combines model resolve + prompt build phases.
 */
export function makeRunBeforeAgentStart(deps: AgentEventDeps) {
  return async function runBeforeAgentStart(
    event: PluginHookBeforeAgentStartEvent,
    ctx: PluginHookAgentContext,
  ): Promise<PluginHookBeforeAgentStartResult | undefined> {
    return runModifyingHook<"before_agent_start", PluginHookBeforeAgentStartResult>(
      { ...deps, hookName: "before_agent_start" },
      event,
      ctx,
      (acc, next) => ({
        ...mergeBeforePromptBuild(acc, next),
        ...mergeBeforeModelResolve(acc, next),
      }),
    );
  };
}

/**
 * Run agent_end hook.
 * Allows plugins to analyze completed conversations.
 * Runs in parallel (fire-and-forget).
 */
export function makeRunAgentEnd(deps: AgentEventDeps) {
  return async function runAgentEnd(
    event: PluginHookAgentEndEvent,
    ctx: PluginHookAgentContext,
  ): Promise<void> {
    return runVoidHook({ ...deps, hookName: "agent_end" }, event, ctx);
  };
}

/**
 * Run llm_input hook.
 * Allows plugins to observe the exact input payload sent to the LLM.
 * Runs in parallel (fire-and-forget).
 */
export function makeRunLlmInput(deps: AgentEventDeps) {
  return async function runLlmInput(
    event: PluginHookLlmInputEvent,
    ctx: PluginHookAgentContext,
  ): Promise<void> {
    return runVoidHook({ ...deps, hookName: "llm_input" }, event, ctx);
  };
}

/**
 * Run llm_output hook.
 * Allows plugins to observe the exact output payload returned by the LLM.
 * Runs in parallel (fire-and-forget).
 */
export function makeRunLlmOutput(deps: AgentEventDeps) {
  return async function runLlmOutput(
    event: PluginHookLlmOutputEvent,
    ctx: PluginHookAgentContext,
  ): Promise<void> {
    return runVoidHook({ ...deps, hookName: "llm_output" }, event, ctx);
  };
}

/**
 * Run before_compaction hook.
 */
export function makeRunBeforeCompaction(deps: AgentEventDeps) {
  return async function runBeforeCompaction(
    event: PluginHookBeforeCompactionEvent,
    ctx: PluginHookAgentContext,
  ): Promise<void> {
    return runVoidHook({ ...deps, hookName: "before_compaction" }, event, ctx);
  };
}

/**
 * Run after_compaction hook.
 */
export function makeRunAfterCompaction(deps: AgentEventDeps) {
  return async function runAfterCompaction(
    event: PluginHookAfterCompactionEvent,
    ctx: PluginHookAgentContext,
  ): Promise<void> {
    return runVoidHook({ ...deps, hookName: "after_compaction" }, event, ctx);
  };
}

/**
 * Run before_reset hook.
 * Fired when /new or /reset clears a session, before messages are lost.
 * Runs in parallel (fire-and-forget).
 */
export function makeRunBeforeReset(deps: AgentEventDeps) {
  return async function runBeforeReset(
    event: PluginHookBeforeResetEvent,
    ctx: PluginHookAgentContext,
  ): Promise<void> {
    return runVoidHook({ ...deps, hookName: "before_reset" }, event, ctx);
  };
}
