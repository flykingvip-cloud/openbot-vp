import type { AgentMessage } from "@earendil-works/pi-agent-core";

/**
 * Compiled messages are what convertToLlm and pi-ai's pre-request token estimate
 * read. `@earendil-works/pi-ai` `estimateMessageTokens` (streamSimple →
 * buildBaseOptions) does `block.text.length` / `block.thinking.length` /
 * `block.name.length`. A non-empty assistant string is iterated as characters,
 * and each character has no `name`, so the throw is
 * `Cannot read properties of undefined (reading 'length')`.
 * That is the api-proxy-deepseek / deepseek-v4-flash shape
 * `{ role: "assistant", content: "answer", reasoning_content: "think" }`,
 * and the context compiler's own string digests.
 * Clean messages keep their identity so current-turn preservation still matches
 * by reference.
 */

const ZERO_ASSISTANT_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function emptyContentForRole(role: unknown): string | unknown[] {
  return role === "assistant" || role === "toolResult" || role === "tool" ? [] : "";
}

/** User and toolResult strings are safe. Every other role uses the assistant loop. */
function usesAssistantTokenEstimate(role: unknown): boolean {
  return role !== "user" && role !== "toolResult";
}

function readReasoningText(record: Record<string, unknown>): string | undefined {
  for (const key of ["reasoning_content", "reasoning", "reasoning_text"]) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function thinkingBlock(thinking: string): {
  type: "thinking";
  thinking: string;
  thinkingSignature: string;
} {
  return { type: "thinking", thinking, thinkingSignature: "reasoning_content" };
}

function blocksFromAssistantString(text: string, reasoning: string | undefined): unknown[] {
  const blocks: unknown[] = [];
  if (reasoning !== undefined) {
    blocks.push(thinkingBlock(reasoning));
  }
  if (text.length > 0) {
    blocks.push({ type: "text", text });
  }
  return blocks;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string") {
      return value;
    }
  }
  return undefined;
}

function toolNameFromBlock(block: Record<string, unknown>): string {
  if (typeof block.name === "string") {
    return block.name;
  }
  if (typeof block.toolName === "string") {
    return block.toolName;
  }
  const fn = block.function;
  if (fn && typeof fn === "object") {
    const name = (fn as { name?: unknown }).name;
    if (typeof name === "string") {
      return name;
    }
  }
  return "";
}

function normalizeContentBlock(block: unknown, role: unknown): unknown {
  if (typeof block === "string") {
    return usesAssistantTokenEstimate(role) ? { type: "text", text: block } : block;
  }
  if (!block || typeof block !== "object") {
    return usesAssistantTokenEstimate(role) ? { type: "text", text: "" } : block;
  }
  const typed = block as Record<string, unknown>;
  if (typed.type === "text") {
    return typeof typed.text === "string" ? block : { ...typed, text: "" };
  }
  if (typed.type === "thinking") {
    return typeof typed.thinking === "string" ? block : { ...typed, thinking: "" };
  }
  if (!usesAssistantTokenEstimate(role)) {
    return block;
  }
  if (
    typed.type === "reasoning" ||
    typed.type === "reasoning_content" ||
    typed.type === "reasoning_text"
  ) {
    return thinkingBlock(
      firstString(
        typed.reasoning,
        typed.reasoning_content,
        typed.thinking,
        typed.text,
        typed.content,
      ) ?? "",
    );
  }
  if (typed.type === undefined && typeof typed.text === "string") {
    return { ...typed, type: "text" };
  }
  if (typeof typed.name === "string") {
    return block;
  }
  return { ...typed, name: toolNameFromBlock(typed) };
}

function withAssistantUsage(message: AgentMessage): AgentMessage {
  if ((message as { role?: unknown }).role !== "assistant") {
    return message;
  }
  const usage = (message as { usage?: unknown }).usage;
  if (usage && typeof usage === "object") {
    return message;
  }
  return {
    ...message,
    usage: { ...ZERO_ASSISTANT_USAGE, cost: { ...ZERO_ASSISTANT_USAGE.cost } },
  } as AgentMessage;
}

export function normalizeCompiledMessage(message: AgentMessage): AgentMessage {
  if (!message || typeof message !== "object") {
    return message;
  }
  // CompactionSummaryMessage has no string index signature, so plugin-sdk dts
  // rejects a direct AgentMessage cast. Bridge through unknown.
  const record = message as unknown as { role?: unknown; content?: unknown } & Record<
    string,
    unknown
  >;
  const content = record.content;
  if (typeof content === "string") {
    if (!usesAssistantTokenEstimate(record.role)) {
      return message;
    }
    const reasoning = readReasoningText(record);
    if (content.length === 0 && reasoning === undefined) {
      return withAssistantUsage(message);
    }
    return withAssistantUsage({
      ...message,
      content: blocksFromAssistantString(content, reasoning),
    } as AgentMessage);
  }
  if (!Array.isArray(content)) {
    const reasoning = usesAssistantTokenEstimate(record.role)
      ? readReasoningText(record)
      : undefined;
    const nextContent =
      reasoning !== undefined
        ? blocksFromAssistantString("", reasoning)
        : emptyContentForRole(record.role);
    return withAssistantUsage({ ...message, content: nextContent } as AgentMessage);
  }
  let changed = false;
  const next = content.map((block) => {
    const normalized = normalizeContentBlock(block, record.role);
    if (normalized !== block) {
      changed = true;
    }
    return normalized;
  });
  const contentMessage = changed ? ({ ...message, content: next } as AgentMessage) : message;
  return withAssistantUsage(contentMessage);
}

export function normalizeCompiledMessages(messages: AgentMessage[]): AgentMessage[] {
  if (!Array.isArray(messages)) {
    return [];
  }
  let changed = false;
  const next = messages.map((message) => {
    const normalized = normalizeCompiledMessage(message);
    if (normalized !== message) {
      changed = true;
    }
    return normalized;
  });
  return changed ? next : messages;
}
