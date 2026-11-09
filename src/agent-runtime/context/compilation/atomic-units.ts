import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ContextUnit } from "../../contracts/context.js";

function isToolResultMessage(message: AgentMessage): boolean {
  const role = (message as { role?: unknown }).role;
  return role === "toolResult" || role === "tool";
}

function hasToolCall(message: AgentMessage): boolean {
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return false;
  }
  return content.some((block) => {
    if (!block || typeof block !== "object") {
      return false;
    }
    const type = (block as { type?: unknown }).type;
    return type === "toolCall" || type === "tool_use" || type === "functionCall";
  });
}

function isUserMessage(message: AgentMessage): boolean {
  return (message as { role?: unknown }).role === "user";
}

function unitHasToolTransaction(messages: AgentMessage[]): boolean {
  return messages.some((message) => isToolResultMessage(message) || hasToolCall(message));
}

/**
 * Group AgentMessages into atomic execution units.
 * A unit is one user request plus its assistant/tool continuation until the next user turn.
 * The compiler may drop a whole unit, or replace a toolCall/toolResult pair together
 * with a digest. It must not leave one side of a pair behind.
 */
export function groupContextUnits(messages: AgentMessage[]): ContextUnit[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  const units: AgentMessage[][] = [];
  let current: AgentMessage[] = [];

  for (const message of messages) {
    if (isUserMessage(message) && current.length > 0) {
      units.push(current);
      current = [message];
      continue;
    }
    current.push(message);
  }
  if (current.length > 0) {
    units.push(current);
  }

  return units.map((unitMessages, index) => {
    const isCurrent = index === units.length - 1;
    if (isCurrent) {
      return { kind: "current_execution_turn", messages: unitMessages };
    }
    return {
      kind: unitHasToolTransaction(unitMessages) ? "tool_execution_turn" : "plain_turn",
      messages: unitMessages,
    };
  });
}

export function flattenContextUnits(units: ContextUnit[]): AgentMessage[] {
  return units.flatMap((unit) => unit.messages);
}

export function assertToolTransactionIntegrity(messages: AgentMessage[]): boolean {
  const pending = new Set<string>();
  for (const message of messages) {
    const content = (message as { content?: unknown }).content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== "object") {
          continue;
        }
        const type = (block as { type?: unknown }).type;
        if (type === "toolCall" || type === "tool_use" || type === "functionCall") {
          const id = (block as { id?: unknown }).id;
          if (typeof id === "string" && id.trim()) {
            pending.add(id);
          }
        }
      }
    }
    if (isToolResultMessage(message)) {
      const toolCallId = (message as { toolCallId?: unknown }).toolCallId;
      if (typeof toolCallId === "string" && toolCallId.trim()) {
        if (!pending.has(toolCallId)) {
          return false;
        }
        pending.delete(toolCallId);
      }
    }
  }
  return true;
}
