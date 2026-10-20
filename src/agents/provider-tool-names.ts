import { logWarn } from "../logger.js";
import {
  allocateUniqueToolName,
  isValidProviderToolName,
  sanitizeToolName,
} from "./pi-tools.schema.js";

const PROVIDER_TOOL_CALL_BLOCK_TYPES = new Set(["toolCall", "tool_use", "functionCall"]);

export type ProviderToolNamePlan = {
  names: string[];
  /** Original name -> sanitized name. First assignment wins. */
  forward: Map<string, string>;
  /** Sanitized name -> original name, for tool-call dispatch. */
  reverse: Map<string, string>;
  changed: boolean;
};

/**
 * Assign OpenAI/DeepSeek-legal, unique tool names in list order.
 * Valid unique names are preserved so dispatch stays stable when nothing is wrong.
 */
export function planProviderToolNames(names: readonly string[]): ProviderToolNamePlan {
  const used = new Set<string>();
  const forward = new Map<string, string>();
  const reverse = new Map<string, string>();
  let changed = false;
  const nextNames = names.map((original) => {
    const originalName = typeof original === "string" ? original : "";
    if (isValidProviderToolName(originalName) && !used.has(originalName)) {
      used.add(originalName);
      return originalName;
    }
    const nextName = allocateUniqueToolName(sanitizeToolName(originalName || "unknown_tool"), used);
    changed = true;
    if (originalName && !forward.has(originalName)) {
      forward.set(originalName, nextName);
    }
    if (!reverse.has(nextName)) {
      reverse.set(nextName, originalName);
    }
    return nextName;
  });
  return { names: nextNames, forward, reverse, changed };
}

function rewriteMessagesForProvider(
  messages: readonly unknown[] | undefined,
  forward: Map<string, string>,
): { messages: unknown[]; changed: boolean } {
  if (!messages || forward.size === 0) {
    return { messages: messages ? [...messages] : [], changed: false };
  }
  let changed = false;
  const next = messages.map((message) => {
    if (!message || typeof message !== "object") {
      return message;
    }
    const record = message as Record<string, unknown>;
    let messageChanged = false;
    const nextMessage: Record<string, unknown> = { ...record };
    if (typeof record.toolName === "string" && forward.has(record.toolName)) {
      nextMessage.toolName = forward.get(record.toolName);
      messageChanged = true;
    }
    if (Array.isArray(record.content)) {
      let contentChanged = false;
      const content = record.content.map((block) => {
        if (!block || typeof block !== "object") {
          return block;
        }
        const blockRecord = block as Record<string, unknown>;
        if (
          typeof blockRecord.type === "string" &&
          PROVIDER_TOOL_CALL_BLOCK_TYPES.has(blockRecord.type) &&
          typeof blockRecord.name === "string" &&
          forward.has(blockRecord.name)
        ) {
          contentChanged = true;
          return { ...blockRecord, name: forward.get(blockRecord.name) };
        }
        return block;
      });
      if (contentChanged) {
        nextMessage.content = content;
        messageChanged = true;
      }
    }
    if (!messageChanged) {
      return message;
    }
    changed = true;
    return nextMessage;
  });
  return { messages: next, changed };
}

/**
 * Copy a provider context so tool names (and history references to them) are legal.
 * The original tool objects are not mutated; callers map response names back via `reverse`.
 */
export function sanitizeStreamContextForProvider<
  T extends { tools?: ReadonlyArray<{ name: string }>; messages?: readonly unknown[] },
>(
  context: T,
  options?: { logWarnings?: boolean },
): { context: T; forward: Map<string, string>; reverse: Map<string, string> } {
  const tools = context.tools;
  if (!tools || tools.length === 0) {
    return { context, forward: new Map(), reverse: new Map() };
  }
  const planned = planProviderToolNames(
    tools.map((tool) => (tool && typeof tool.name === "string" ? tool.name : "")),
  );
  if (!planned.changed) {
    return { context, forward: planned.forward, reverse: planned.reverse };
  }
  const logWarnings = options?.logWarnings ?? true;
  const nextTools = tools.map((tool, index) => {
    const nextName = planned.names[index] ?? "unknown_tool";
    if (!tool || tool.name === nextName) {
      return tool;
    }
    if (logWarnings) {
      logWarn(
        `[Tool Name Validation] Sanitized outbound tool name: "${tool.name}" → "${nextName}"`,
      );
    }
    return { ...tool, name: nextName };
  });
  const messages = rewriteMessagesForProvider(context.messages, planned.forward);
  return {
    context: {
      ...context,
      tools: nextTools,
      ...(messages.changed ? { messages: messages.messages } : {}),
    } as T,
    forward: planned.forward,
    reverse: planned.reverse,
  };
}

/** Rewrite tool_choice / toolChoice function names with an existing forward map. */
export function sanitizeStreamToolChoice(
  toolChoice: unknown,
  forward: Map<string, string>,
): unknown {
  if (!toolChoice || typeof toolChoice !== "object" || forward.size === 0) {
    return toolChoice;
  }
  const choice = toolChoice as Record<string, unknown>;
  const fn = choice.function;
  if (fn && typeof fn === "object") {
    const name = (fn as Record<string, unknown>).name;
    if (typeof name === "string" && forward.has(name)) {
      return {
        ...choice,
        function: { ...(fn as Record<string, unknown>), name: forward.get(name) },
      };
    }
  }
  if (typeof choice.name === "string" && forward.has(choice.name)) {
    return { ...choice, name: forward.get(choice.name) };
  }
  return toolChoice;
}

function restoreToolName(name: string, reverse: Map<string, string>): string | undefined {
  const restored = reverse.get(name);
  if (!restored) {
    return undefined;
  }
  return restored;
}

/** Map sanitized tool-call names on a stream event back to the registered tool name. */
export function restoreProviderToolNamesInEvent(
  event: unknown,
  reverse: Map<string, string>,
): void {
  if (reverse.size === 0) {
    return;
  }
  restoreProviderToolNamesInValue(event, reverse, 0);
}

function restoreProviderToolNamesInValue(
  value: unknown,
  reverse: Map<string, string>,
  depth: number,
): void {
  if (!value || typeof value !== "object" || depth > 3) {
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.toolName === "string") {
    const restored = restoreToolName(record.toolName, reverse);
    if (restored) {
      record.toolName = restored;
    }
  }
  if (Array.isArray(record.content)) {
    for (const block of record.content) {
      if (!block || typeof block !== "object") {
        continue;
      }
      const blockRecord = block as Record<string, unknown>;
      if (
        typeof blockRecord.type === "string" &&
        PROVIDER_TOOL_CALL_BLOCK_TYPES.has(blockRecord.type) &&
        typeof blockRecord.name === "string"
      ) {
        const restored = restoreToolName(blockRecord.name, reverse);
        if (restored) {
          blockRecord.name = restored;
        }
      }
    }
  }
  if (depth < 2) {
    restoreProviderToolNamesInValue(record.partial, reverse, depth + 1);
    restoreProviderToolNamesInValue(record.message, reverse, depth + 1);
    restoreProviderToolNamesInValue(record.error, reverse, depth + 1);
  }
}

function readPayloadToolName(tool: unknown): string {
  if (!tool || typeof tool !== "object") {
    return "";
  }
  const record = tool as Record<string, unknown>;
  const fn = record.function;
  if (fn && typeof fn === "object" && typeof (fn as Record<string, unknown>).name === "string") {
    return (fn as Record<string, unknown>).name as string;
  }
  const custom = record.custom;
  if (
    custom &&
    typeof custom === "object" &&
    typeof (custom as Record<string, unknown>).name === "string"
  ) {
    return (custom as Record<string, unknown>).name as string;
  }
  return typeof record.name === "string" ? record.name : "";
}

function writePayloadToolName(tool: unknown, name: string): void {
  if (!tool || typeof tool !== "object") {
    return;
  }
  const record = tool as Record<string, unknown>;
  const fn = record.function;
  if (fn && typeof fn === "object" && "name" in (fn as Record<string, unknown>)) {
    (fn as Record<string, unknown>).name = name;
    return;
  }
  const custom = record.custom;
  if (custom && typeof custom === "object" && "name" in (custom as Record<string, unknown>)) {
    (custom as Record<string, unknown>).name = name;
    return;
  }
  record.name = name;
}

function forcePayloadFunctionName(
  name: unknown,
  forward: Map<string, string>,
  used: Set<string>,
): string | undefined {
  if (typeof name !== "string" || !name) {
    return undefined;
  }
  const mapped = forward.get(name);
  if (mapped) {
    return mapped === name ? undefined : mapped;
  }
  if (isValidProviderToolName(name)) {
    return undefined;
  }
  const next = allocateUniqueToolName(sanitizeToolName(name), used);
  forward.set(name, next);
  return next;
}

function rewritePayloadFunctionName(
  holder: Record<string, unknown>,
  key: string,
  forward: Map<string, string>,
  used: Set<string>,
): void {
  const next = forcePayloadFunctionName(holder[key], forward, used);
  if (next !== undefined) {
    holder[key] = next;
  }
}

function scrubPayloadMessage(
  message: unknown,
  forward: Map<string, string>,
  used: Set<string>,
): void {
  if (!message || typeof message !== "object") {
    return;
  }
  const record = message as Record<string, unknown>;
  if (typeof record.tool_name === "string") {
    rewritePayloadFunctionName(record, "tool_name", forward, used);
  }
  if (record.type === "function_call") {
    rewritePayloadFunctionName(record, "name", forward, used);
  }
  if (!Array.isArray(record.tool_calls)) {
    return;
  }
  for (const call of record.tool_calls) {
    if (!call || typeof call !== "object") {
      continue;
    }
    const fn = (call as Record<string, unknown>).function;
    if (fn && typeof fn === "object") {
      rewritePayloadFunctionName(fn as Record<string, unknown>, "name", forward, used);
    }
  }
}

/**
 * Last-mile scrub of an OpenAI/Ollama/Responses payload.
 * Mutates `tools[].function.name` (and history names that reference them) in place.
 * Returns sanitized -> pre-scrub name for any definition that had to change.
 */
export function scrubProviderToolPayload(payload: unknown): Map<string, string> {
  if (!payload || typeof payload !== "object") {
    return new Map();
  }
  const record = payload as Record<string, unknown>;
  const tools = record.tools;
  if (!Array.isArray(tools) || tools.length === 0) {
    return new Map();
  }
  const planned = planProviderToolNames(tools.map((tool) => readPayloadToolName(tool)));
  if (planned.changed) {
    tools.forEach((tool, index) => {
      const nextName = planned.names[index];
      if (nextName) {
        writePayloadToolName(tool, nextName);
      }
    });
  }
  const used = new Set(planned.names.filter((name) => name.length > 0));
  const buckets = [record.messages, record.input];
  for (const bucket of buckets) {
    if (!Array.isArray(bucket)) {
      continue;
    }
    for (const message of bucket) {
      scrubPayloadMessage(message, planned.forward, used);
    }
  }
  const toolChoice = record.tool_choice ?? record.toolChoice;
  if (toolChoice && typeof toolChoice === "object") {
    const choice = toolChoice as Record<string, unknown>;
    const fn = choice.function;
    if (fn && typeof fn === "object") {
      rewritePayloadFunctionName(fn as Record<string, unknown>, "name", planned.forward, used);
    }
    if (typeof choice.name === "string") {
      rewritePayloadFunctionName(choice, "name", planned.forward, used);
    }
  }
  return planned.reverse;
}
