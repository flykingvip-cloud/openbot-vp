/**
 * Host-initiated execute for composer @plugin / @connector mentions.
 *
 * Mirrors skill inline dispatch (`get-reply-inline-actions`): resolve the real
 * tools the mention names, derive args from the user message, call tool.execute.
 * Does not invent a second agent/planner.
 */

import type { AnyAgentTool } from "../../agents/tools/common.js";
import { createUserOperationalIdentityTool } from "../../agents/tools/user-operational-identity-tool.js";
import type { OpenBotConfig } from "../../config/config.js";
import type { ExecutionIdentityContext } from "../../gateway/execution-identity-context.js";
import type { GatewayClient } from "../../gateway/server-methods/types.js";
import { generateSecureToken } from "../../infra/secure-random.js";
import { resolveMentionTarget } from "../../organization/mention-target.js";
import type { MentionMetadata } from "../../organization/mention-types.js";
import { getPluginToolMeta, resolvePluginTools } from "../../plugins/tools.js";
import type {
  ComposerPluginMentionBindings,
  ComposerPluginMentionConnector,
  ComposerPluginMentionPlugin,
} from "./composer-plugin-mention-bindings.js";

const FREEFORM_ARG_KEYS = [
  "command",
  "prompt",
  "message",
  "query",
  "text",
  "task",
  "pipeline",
  "argsJson",
  "input",
  "body",
  "content",
] as const;

export type ComposerPluginMentionExecutionCall = {
  kind: "plugin" | "connector";
  pluginId: string;
  toolName: string;
  args: Record<string, unknown>;
  ok: boolean;
  resultText?: string;
  error?: string;
};

export type ComposerPluginMentionExecutionResult = {
  calls: ComposerPluginMentionExecutionCall[];
  /** Injected into the turn system prompt so the agent sees host-run results. */
  summaryPrompt?: string;
};

function schemaProperties(parameters: unknown): Record<string, unknown> {
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
    return {};
  }
  const record = parameters as Record<string, unknown>;
  const props = record.properties;
  if (!props || typeof props !== "object" || Array.isArray(props)) {
    return {};
  }
  return props as Record<string, unknown>;
}

function isStringishSchema(schema: unknown): boolean {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return false;
  }
  const type = (schema as { type?: unknown }).type;
  return type === "string" || type === undefined;
}

/**
 * Map the user message onto a tool's JSON-schema parameters (skill-dispatch style).
 * Prefers freeform keys (command/prompt/message/…); sets action=run when available.
 */
export function buildToolArgsFromUserMessage(
  tool: { parameters?: unknown },
  userMessage: string,
): Record<string, unknown> {
  const message = userMessage.trim();
  const props = schemaProperties(tool.parameters);
  const args: Record<string, unknown> = {};

  const actionSchema = props.action;
  if (actionSchema && typeof actionSchema === "object" && !Array.isArray(actionSchema)) {
    const enums = (actionSchema as { enum?: unknown }).enum;
    if (Array.isArray(enums)) {
      if (enums.includes("run")) {
        args.action = "run";
      } else if (enums.includes("list")) {
        args.action = "list";
      }
    }
  }

  for (const key of FREEFORM_ARG_KEYS) {
    if (key in props && isStringishSchema(props[key])) {
      args[key] = message;
      return args;
    }
  }

  for (const [key, schema] of Object.entries(props)) {
    if (key === "action") {
      continue;
    }
    if (isStringishSchema(schema)) {
      args[key] = message;
      return args;
    }
  }

  // Last resort: still pass the message under `message` so execute is never empty.
  args.message = message;
  return args;
}

/** Strip @displayName spans for plugin mentions so the task text is the remainder. */
export function resolveComposerPluginMentionTaskMessage(params: {
  rawMessage: string;
  mentions?: readonly MentionMetadata[] | null;
}): string {
  const raw = params.rawMessage ?? "";
  const pluginMentions = (params.mentions ?? [])
    .filter((mention) => resolveMentionTarget(mention)?.kind === "plugin")
    .toSorted((a, b) => b.offset - a.offset);
  let text = raw;
  for (const mention of pluginMentions) {
    const start = Math.max(0, mention.offset);
    const end = Math.min(text.length, mention.offset + mention.length);
    if (end > start) {
      text = `${text.slice(0, start)}${text.slice(end)}`;
    }
  }
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned || raw.trim();
}

function extractTextFromToolResult(result: unknown): string | undefined {
  if (!result || typeof result !== "object") {
    return undefined;
  }
  const content = (result as { content?: unknown }).content;
  if (typeof content === "string") {
    const trimmed = content.trim();
    return trimmed || undefined;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object" && (block as { type?: string }).type === "text") {
      const text = (block as { text?: unknown }).text;
      if (typeof text === "string" && text.trim()) {
        parts.push(text.trim());
      }
    }
  }
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function argsCarryUserMessage(args: Record<string, unknown>, userMessage: string): boolean {
  const needle = userMessage.trim();
  if (!needle) {
    return false;
  }
  return Object.values(args).some((value) => typeof value === "string" && value.includes(needle));
}

async function executeOneTool(params: {
  kind: "plugin" | "connector";
  pluginId: string;
  tool: AnyAgentTool;
  args: Record<string, unknown>;
}): Promise<ComposerPluginMentionExecutionCall> {
  const toolCallId = `mention_${generateSecureToken(8)}`;
  try {
    const result = await params.tool.execute(toolCallId, params.args);
    return {
      kind: params.kind,
      pluginId: params.pluginId,
      toolName: params.tool.name,
      args: params.args,
      ok: true,
      resultText: extractTextFromToolResult(result),
    };
  } catch (err) {
    return {
      kind: params.kind,
      pluginId: params.pluginId,
      toolName: params.tool.name,
      args: params.args,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function executeOpenBotPluginMention(params: {
  plugin: ComposerPluginMentionPlugin;
  userMessage: string;
  config?: OpenBotConfig;
  workspaceDir?: string;
  agentDir?: string;
  agentId?: string;
  sessionKey?: string;
  resolveTools?: typeof resolvePluginTools;
}): Promise<ComposerPluginMentionExecutionCall[]> {
  const resolveTools = params.resolveTools ?? resolvePluginTools;
  const tools = resolveTools({
    context: {
      config: params.config,
      workspaceDir: params.workspaceDir,
      agentDir: params.agentDir,
      agentId: params.agentId,
      sessionKey: params.sessionKey,
    },
    toolAllowlist: [params.plugin.openBotPluginId],
    suppressNameConflicts: true,
  }).filter((tool) => {
    const meta = getPluginToolMeta(tool);
    // resolvePluginTools stamps meta; injected test tools may omit it.
    return !meta || meta.pluginId === params.plugin.openBotPluginId;
  });

  const calls: ComposerPluginMentionExecutionCall[] = [];
  for (const tool of tools) {
    const args = buildToolArgsFromUserMessage(tool, params.userMessage);
    if (!argsCarryUserMessage(args, params.userMessage)) {
      continue;
    }
    calls.push(
      await executeOneTool({
        kind: "plugin",
        pluginId: params.plugin.pluginId,
        tool,
        args,
      }),
    );
  }
  return calls;
}

async function executeConnectorMention(params: {
  connector: ComposerPluginMentionConnector;
  userMessage: string;
  agentSessionKey?: string;
  requesterAgentIdOverride?: string;
  gatewayClientUser?: string;
  gatewayClientSessionDomain?: GatewayClient["sessionDomain"];
  gatewayClientPlatformUserId?: string;
  createIdentityTool?: typeof createUserOperationalIdentityTool;
}): Promise<ComposerPluginMentionExecutionCall[]> {
  const createIdentityTool = params.createIdentityTool ?? createUserOperationalIdentityTool;
  const tool = createIdentityTool({
    agentSessionKey: params.agentSessionKey,
    requesterAgentIdOverride: params.requesterAgentIdOverride,
    gatewayClientUser: params.gatewayClientUser,
    gatewayClientSessionDomain: params.gatewayClientSessionDomain,
    gatewayClientPlatformUserId: params.gatewayClientPlatformUserId,
  });
  // Host entry into the connector for this turn: list granted actions, carrying
  // the user message so execute args are derived from the task (not empty).
  const args: Record<string, unknown> = {
    action: "list",
    message: params.userMessage,
  };
  if (params.connector.provider) {
    args.provider = params.connector.provider;
  }
  return [
    await executeOneTool({
      kind: "connector",
      pluginId: params.connector.pluginId,
      tool,
      args,
    }),
  ];
}

function formatExecutionSummary(calls: ComposerPluginMentionExecutionCall[]): string | undefined {
  if (calls.length === 0) {
    return undefined;
  }
  const lines = calls.map((call) => {
    const status = call.ok ? "ok" : `error: ${call.error ?? "failed"}`;
    const preview = call.resultText ? ` → ${call.resultText.slice(0, 240)}` : "";
    return `- ${call.kind} ${call.pluginId} / ${call.toolName} (${status})${preview}`;
  });
  return [
    "Composer @plugin/@connector mentions were host-executed for this turn (skill-dispatch style) using the user message as tool args:",
    ...lines,
    "Continue the user task with these results; call the same tools again only if more work remains.",
  ].join("\n");
}

export async function executeComposerPluginMentionsForTurn(params: {
  bindings: ComposerPluginMentionBindings;
  userMessage: string;
  mentions?: readonly MentionMetadata[] | null;
  config?: OpenBotConfig;
  workspaceDir?: string;
  agentDir?: string;
  agentId?: string;
  sessionKey?: string;
  gatewayClientUser?: string;
  gatewayClientSessionDomain?: GatewayClient["sessionDomain"];
  gatewayClientPlatformUserId?: string;
  executionIdentity?: ExecutionIdentityContext;
  /** Test seams */
  resolveTools?: typeof resolvePluginTools;
  createIdentityTool?: typeof createUserOperationalIdentityTool;
}): Promise<ComposerPluginMentionExecutionResult> {
  const taskMessage = resolveComposerPluginMentionTaskMessage({
    rawMessage: params.userMessage,
    mentions: params.mentions ?? undefined,
  });
  if (!taskMessage) {
    return { calls: [] };
  }
  if (params.bindings.plugins.length === 0 && params.bindings.connectors.length === 0) {
    return { calls: [] };
  }

  const calls: ComposerPluginMentionExecutionCall[] = [];
  for (const plugin of params.bindings.plugins) {
    calls.push(
      ...(await executeOpenBotPluginMention({
        plugin,
        userMessage: taskMessage,
        config: params.config,
        workspaceDir: params.workspaceDir,
        agentDir: params.agentDir,
        agentId: params.agentId,
        sessionKey: params.sessionKey,
        resolveTools: params.resolveTools,
      })),
    );
  }
  for (const connector of params.bindings.connectors) {
    calls.push(
      ...(await executeConnectorMention({
        connector,
        userMessage: taskMessage,
        agentSessionKey: params.sessionKey,
        requesterAgentIdOverride: params.agentId,
        gatewayClientUser: params.gatewayClientUser ?? params.executionIdentity?.user,
        gatewayClientSessionDomain:
          params.gatewayClientSessionDomain ?? params.executionIdentity?.sessionDomain,
        gatewayClientPlatformUserId:
          params.gatewayClientPlatformUserId ?? params.executionIdentity?.platformUserId,
        createIdentityTool: params.createIdentityTool,
      })),
    );
  }

  const summaryPrompt = formatExecutionSummary(calls);
  return {
    calls,
    ...(summaryPrompt ? { summaryPrompt } : {}),
  };
}
