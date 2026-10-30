import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  TOOL_DIGEST_CLOSE_SENTINEL,
  TOOL_DIGEST_OPEN_SENTINEL,
} from "../../shared/text/control-channel-visibility.js";
import {
  getToolResultText,
  isToolResultMessage,
} from "../pi-embedded-runner/tool-result-char-estimator.js";

/** Visible result text kept when a tool pair is replaced by a digest. */
export const TOOL_DIGEST_RESULT_CHARS = 300;

const KEY_ARG_PRIORITY = [
  "action",
  "url",
  "target",
  "ref",
  "query",
  "command",
  "selector",
  "text",
  "name",
  "path",
] as const;

const MAX_KEY_ARGS = 4;
const MAX_ARG_VALUE_CHARS = 80;
const MAX_COMPACT_ARG_CHARS = 200;

type ToolCallRef = {
  id?: string;
  name: string;
  args: unknown;
};

type PendingResult = {
  message: AgentMessage;
  id?: string;
  used: boolean;
};

function messageRole(message: AgentMessage): string {
  const role = (message as { role?: unknown }).role;
  return typeof role === "string" ? role : "";
}

export function readVisibleMessageText(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const typed = block as { type?: unknown; text?: unknown };
    if (
      typed.type === "thinking" ||
      typed.type === "toolCall" ||
      typed.type === "tool_use" ||
      typed.type === "functionCall"
    ) {
      continue;
    }
    if (typeof typed.text === "string" && (typed.type === "text" || typed.type === undefined)) {
      parts.push(typed.text);
    }
  }
  return parts.join("\n");
}

function isUserMessage(message: AgentMessage): boolean {
  return messageRole(message) === "user";
}

function isAssistantMessage(message: AgentMessage): boolean {
  return messageRole(message) === "assistant";
}

function readToolCalls(message: AgentMessage): ToolCallRef[] {
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return [];
  }
  const calls: ToolCallRef[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const record = block as Record<string, unknown>;
    const type = record.type;
    if (type !== "toolCall" && type !== "tool_use" && type !== "functionCall") {
      continue;
    }
    const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : undefined;
    calls.push({
      id,
      name: readToolName(record),
      args: readToolArgs(record),
    });
  }
  return calls;
}

function readToolName(block: Record<string, unknown>): string {
  const direct = block.name ?? block.toolName;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }
  const fn = block.function;
  if (fn && typeof fn === "object") {
    const name = (fn as { name?: unknown }).name;
    if (typeof name === "string" && name.trim()) {
      return name.trim();
    }
  }
  return "tool";
}

function readToolArgs(block: Record<string, unknown>): unknown {
  if ("arguments" in block) {
    return block.arguments;
  }
  if ("input" in block) {
    return block.input;
  }
  if ("args" in block) {
    return block.args;
  }
  return undefined;
}

function readToolCallId(message: AgentMessage): string | undefined {
  const record = message as { toolCallId?: unknown; tool_call_id?: unknown };
  if (typeof record.toolCallId === "string" && record.toolCallId.trim()) {
    return record.toolCallId.trim();
  }
  if (typeof record.tool_call_id === "string" && record.tool_call_id.trim()) {
    return record.tool_call_id.trim();
  }
  return undefined;
}

export function messageHasToolCall(message: AgentMessage): boolean {
  return readToolCalls(message).length > 0;
}

export function unitHasToolTransaction(messages: AgentMessage[]): boolean {
  return messages.some((message) => isToolResultMessage(message) || messageHasToolCall(message));
}

export function unitUserRequestPreview(messages: AgentMessage[]): string | undefined {
  for (const message of messages) {
    if (!isUserMessage(message)) {
      continue;
    }
    const text = readVisibleMessageText(message).trim();
    if (text) {
      return text.slice(0, 80);
    }
  }
  return undefined;
}

function coerceArgs(args: unknown): Record<string, unknown> | undefined {
  if (typeof args === "string") {
    const trimmed = args.trim();
    if (!trimmed) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return undefined;
    }
    return undefined;
  }
  if (args && typeof args === "object" && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  return undefined;
}

function isCompactArgValue(value: unknown): boolean {
  if (typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= MAX_COMPACT_ARG_CHARS
  );
}

function compactArgValue(value: unknown): string {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_ARG_VALUE_CHARS);
}

function summarizeKeyArgs(args: unknown): string {
  const record = coerceArgs(args);
  if (!record) {
    return "";
  }
  const keys = Object.keys(record);
  const preferred = KEY_ARG_PRIORITY.filter(
    (key) => key in record && isCompactArgValue(record[key]),
  );
  const rest = keys.filter(
    (key) =>
      !KEY_ARG_PRIORITY.includes(key as (typeof KEY_ARG_PRIORITY)[number]) &&
      isCompactArgValue(record[key]),
  );
  return [...preferred, ...rest]
    .slice(0, MAX_KEY_ARGS)
    .map((key) => {
      const value = compactArgValue(record[key]);
      return value ? `${key}=${value}` : "";
    })
    .filter((part) => part.length > 0)
    .join(" ");
}

function resultPreview(message: AgentMessage): string {
  const text = getToolResultText(message);
  if (text) {
    return text.slice(0, TOOL_DIGEST_RESULT_CHARS);
  }
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    return content.slice(0, TOOL_DIGEST_RESULT_CHARS);
  }
  try {
    const serialized = JSON.stringify(content ?? "");
    return typeof serialized === "string" ? serialized.slice(0, TOOL_DIGEST_RESULT_CHARS) : "";
  } catch {
    return "";
  }
}

function formatToolDigest(call: ToolCallRef, result: AgentMessage): string {
  const args = summarizeKeyArgs(call.args);
  const head = args ? `[tool-digest] ${call.name} ${args}` : `[tool-digest] ${call.name}`;
  const preview = resultPreview(result);
  const body = preview ? `${head}\n${preview}` : head;
  // Sentinel wrap is the trusted unit boundary for history/display strip — blank
  // lines inside the preview must not be treated as a real-reply separator.
  return `${TOOL_DIGEST_OPEN_SENTINEL}\n${body}\n${TOOL_DIGEST_CLOSE_SENTINEL}`;
}

function digestMessage(call: ToolCallRef, result: AgentMessage): AgentMessage {
  const timestamp = (result as { timestamp?: unknown }).timestamp;
  return {
    role: "assistant",
    content: formatToolDigest(call, result),
    // Provenance marker so history can drop the whole digest without parsing body.
    openbotControlChannel: "tool-digest",
    ...(typeof timestamp === "number" ? { timestamp } : {}),
  } as unknown as AgentMessage;
}

function takeMatchingResult(
  results: PendingResult[],
  id: string | undefined,
): AgentMessage | undefined {
  const match = id
    ? results.find((result) => !result.used && result.id === id)
    : results.find((result) => !result.used && !result.id);
  if (!match) {
    return undefined;
  }
  match.used = true;
  return match.message;
}

/**
 * Replace each complete toolCall/toolResult pair with one short digest.
 * Unpaired calls and orphan results are omitted together so neither side remains.
 */
function buildToolDigests(messages: AgentMessage[]): AgentMessage[] {
  const calls: ToolCallRef[] = [];
  const results: PendingResult[] = [];
  for (const message of messages) {
    if (isToolResultMessage(message)) {
      results.push({ message, id: readToolCallId(message), used: false });
      continue;
    }
    calls.push(...readToolCalls(message));
  }
  const digests: AgentMessage[] = [];
  for (const call of calls) {
    const result = takeMatchingResult(results, call.id);
    if (!result) {
      continue;
    }
    digests.push(digestMessage(call, result));
  }
  return digests;
}

function findFinalAssistantMessage(messages: AgentMessage[]): AgentMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || !isAssistantMessage(message)) {
      continue;
    }
    if (readVisibleMessageText(message).trim()) {
      return message;
    }
  }
  return undefined;
}

function projectFinalAssistant(message: AgentMessage): AgentMessage {
  if (!messageHasToolCall(message)) {
    return message;
  }
  const timestamp = (message as { timestamp?: unknown }).timestamp;
  return {
    role: "assistant",
    content: readVisibleMessageText(message).trim(),
    ...(typeof timestamp === "number" ? { timestamp } : {}),
  } as unknown as AgentMessage;
}

/**
 * Keep the user message and the final assistant text.
 * `digest` replaces tool pairs; `user-and-final` drops those digests too.
 */
export function projectUnitMessages(
  messages: AgentMessage[],
  mode: "digest" | "user-and-final",
): AgentMessage[] {
  const users = messages.filter((message) => isUserMessage(message));
  const finalAssistant = findFinalAssistantMessage(messages);
  const projected: AgentMessage[] = [...users];
  if (mode === "digest") {
    projected.push(...buildToolDigests(messages));
  }
  if (finalAssistant) {
    projected.push(projectFinalAssistant(finalAssistant));
  }
  return projected;
}
