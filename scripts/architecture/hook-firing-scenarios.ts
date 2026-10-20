import { createHash } from "node:crypto";
import { createHookRunner } from "../../src/plugins/hooks.js";
import { TEST_PLUGIN_AGENT_CTX } from "../../src/plugins/hooks.test-helpers.js";
import { createEmptyPluginRegistry, type PluginRegistry } from "../../src/plugins/registry.js";
import type {
  PluginHookBeforeAgentStartResult,
  PluginHookBeforeModelResolveResult,
  PluginHookBeforePromptBuildResult,
  PluginHookBeforeToolCallResult,
  PluginHookRegistration,
  PluginHookSubagentSpawningResult,
} from "../../src/plugins/types.js";

export type HookFiringRecord = {
  hookName: string;
  pluginId: string;
  phase: string;
  payloadHash: string;
};

export type HookFiringTrace = {
  scenario: string;
  records: HookFiringRecord[];
};

function canonicalJson(value: unknown): string {
  if (value === undefined) {
    return "null";
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .toSorted();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${entries.join(",")}}`;
}

export function hashHookPayload(event: unknown, ctx: unknown): string {
  const payload = canonicalJson({ event, ctx });
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

function resolvePhase(hookName: string): string {
  return hookName.startsWith("before_") ? "before" : hookName;
}

function addHook(
  registry: PluginRegistry,
  params: {
    pluginId: string;
    hookName: PluginHookRegistration["hookName"];
    handler: PluginHookRegistration["handler"];
    priority?: number;
  },
): void {
  registry.typedHooks.push({
    pluginId: params.pluginId,
    hookName: params.hookName,
    handler: params.handler,
    priority: params.priority ?? 0,
    source: "hook-firing-scenario",
  } as PluginHookRegistration);
}

function instrumentRegistry(registry: PluginRegistry, records: HookFiringRecord[]): void {
  for (const hook of registry.typedHooks) {
    const original = hook.handler;
    const hookName = hook.hookName;
    const pluginId = hook.pluginId;
    const phase = resolvePhase(hookName);
    hook.handler = (async (event: unknown, ctx: unknown) => {
      records.push({
        hookName,
        pluginId,
        phase,
        payloadHash: hashHookPayload(event, ctx),
      });
      return (original as (e: unknown, c: unknown) => unknown)(event, ctx);
    }) as PluginHookRegistration["handler"];
  }
}

const stubCtx = TEST_PLUGIN_AGENT_CTX;

type ScenarioRunner = (records: HookFiringRecord[]) => Promise<void>;

const SCENARIOS: Record<string, ScenarioRunner> = {
  before_agent_start_empty_registry: async (records) => {
    const registry = createEmptyPluginRegistry();
    instrumentRegistry(registry, records);
    const runner = createHookRunner(registry);
    await runner.runBeforeAgentStart({ prompt: "hello" }, stubCtx);
  },

  before_model_resolve_priority_override: async (records) => {
    const registry = createEmptyPluginRegistry();
    addHook(registry, {
      pluginId: "low-priority",
      hookName: "before_model_resolve",
      priority: 1,
      handler: () => ({ modelOverride: "gpt-4o" }) as PluginHookBeforeModelResolveResult,
    });
    addHook(registry, {
      pluginId: "high-priority",
      hookName: "before_model_resolve",
      priority: 10,
      handler: () =>
        ({
          modelOverride: "llama3.3:8b",
          providerOverride: "ollama",
        }) as PluginHookBeforeModelResolveResult,
    });
    instrumentRegistry(registry, records);
    const runner = createHookRunner(registry);
    await runner.runBeforeModelResolve({ prompt: "PII prompt" }, stubCtx);
  },

  before_prompt_build_prepend_concat: async (records) => {
    const registry = createEmptyPluginRegistry();
    addHook(registry, {
      pluginId: "low",
      hookName: "before_prompt_build",
      priority: 1,
      handler: () => ({ prependContext: "context B" }) as PluginHookBeforePromptBuildResult,
    });
    addHook(registry, {
      pluginId: "high",
      hookName: "before_prompt_build",
      priority: 10,
      handler: () =>
        ({
          prependContext: "context A",
          systemPrompt: "system A",
        }) as PluginHookBeforePromptBuildResult,
    });
    instrumentRegistry(registry, records);
    const runner = createHookRunner(registry);
    await runner.runBeforePromptBuild({ prompt: "test", messages: [] }, stubCtx);
  },

  before_agent_start_legacy_compat_merge: async (records) => {
    const registry = createEmptyPluginRegistry();
    addHook(registry, {
      pluginId: "legacy-router",
      hookName: "before_agent_start",
      priority: 10,
      handler: () =>
        ({
          modelOverride: "llama3.3:8b",
          providerOverride: "ollama",
        }) as PluginHookBeforeAgentStartResult,
    });
    addHook(registry, {
      pluginId: "legacy-context",
      hookName: "before_agent_start",
      priority: 1,
      handler: () => ({ prependContext: "legacy prepend" }) as PluginHookBeforeAgentStartResult,
    });
    instrumentRegistry(registry, records);
    const runner = createHookRunner(registry);
    await runner.runBeforeAgentStart({ prompt: "sensitive" }, stubCtx);
  },

  message_received_parallel_two_plugins: async (records) => {
    const registry = createEmptyPluginRegistry();
    addHook(registry, {
      pluginId: "audit-plugin",
      hookName: "message_received",
      handler: async () => {},
    });
    addHook(registry, {
      pluginId: "metrics-plugin",
      hookName: "message_received",
      handler: async () => {},
    });
    instrumentRegistry(registry, records);
    const runner = createHookRunner(registry);
    await runner.runMessageReceived(
      { from: "user-1", content: "hi", timestamp: 1_700_000_000_000 },
      { channelId: "telegram", accountId: "default" },
    );
  },

  subagent_spawning_sequential_merge: async (records) => {
    const registry = createEmptyPluginRegistry();
    const event = {
      childSessionKey: "agent:main:subagent:child",
      agentId: "main",
      label: "research",
      mode: "session" as const,
      requester: {
        channel: "discord" as const,
        accountId: "work",
        to: "channel:123",
        threadId: "456",
      },
      threadRequested: true,
    };
    const ctx = {
      childSessionKey: "agent:main:subagent:child",
      requesterSessionKey: "agent:main:main",
    };
    addHook(registry, {
      pluginId: "channel-plugin-A",
      hookName: "subagent_spawning",
      priority: 10,
      handler: () =>
        ({ status: "ok", threadBindingReady: true }) as PluginHookSubagentSpawningResult,
    });
    addHook(registry, {
      pluginId: "channel-plugin-B",
      hookName: "subagent_spawning",
      priority: 1,
      handler: () =>
        ({ status: "ok", threadBindingReady: false }) as PluginHookSubagentSpawningResult,
    });
    instrumentRegistry(registry, records);
    const runner = createHookRunner(registry);
    await runner.runSubagentSpawning(event, ctx);
  },

  before_tool_call_block_takes_priority: async (records) => {
    const registry = createEmptyPluginRegistry();
    const event = { toolName: "exec", params: { command: "ls" } };
    const ctx = { agentId: "main", sessionKey: "agent:main:main", toolName: "exec" };
    addHook(registry, {
      pluginId: "guard-plugin",
      hookName: "before_tool_call",
      priority: 10,
      handler: () => ({ block: true, blockReason: "denied" }) as PluginHookBeforeToolCallResult,
    });
    addHook(registry, {
      pluginId: "param-plugin",
      hookName: "before_tool_call",
      priority: 1,
      handler: () => ({ params: { command: "ls -la" } }) as PluginHookBeforeToolCallResult,
    });
    instrumentRegistry(registry, records);
    const runner = createHookRunner(registry);
    await runner.runBeforeToolCall(event, ctx);
  },
};

export async function captureTraceByName(scenarioName: string): Promise<HookFiringTrace> {
  const run = SCENARIOS[scenarioName];
  if (!run) {
    throw new Error(`Unknown hook firing scenario: ${scenarioName}`);
  }
  const records: HookFiringRecord[] = [];
  await run(records);
  return { scenario: scenarioName, records };
}
