import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { getRunReplyLanguage } from "../../shared/text/run-reply-language.js";

/**
 * Recency reminder appended after context compile, so it is the last thing
 * the model sees on every call in the turn. Not inserted between a tool call
 * and its result.
 */

export const REPLY_LANGUAGE_REMINDERS = {
  zh: "用中文回复用户。",
  en: "Reply to the user in English.",
} as const;

type ReminderMessage = {
  role?: string;
  content?: unknown;
};

type ReminderTransform = (
  messages: AgentMessage[],
  signal?: AbortSignal,
) => AgentMessage[] | Promise<AgentMessage[]>;

function messagePlainText(message: ReminderMessage): string {
  const content = message.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => {
      if (!block || typeof block !== "object") {
        return "";
      }
      const entry = block as { type?: unknown; text?: unknown };
      return entry.type === "text" && typeof entry.text === "string" ? entry.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function contentHasToolCall(content: unknown): boolean {
  if (!Array.isArray(content)) {
    return false;
  }
  return content.some((block) => {
    if (!block || typeof block !== "object") {
      return false;
    }
    const type = (block as { type?: unknown }).type;
    return type === "toolCall" || type === "tool_use" || type === "tool_call";
  });
}

function endsWithPendingToolCall(messages: ReminderMessage[]): boolean {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") {
    return false;
  }
  return contentHasToolCall(last.content);
}

export function appendReplyLanguageReminder<T extends ReminderMessage>(
  messages: T[],
  language: "zh" | "en" | null,
): T[] {
  if (language !== "zh" && language !== "en") {
    return messages;
  }
  if (endsWithPendingToolCall(messages)) {
    return messages;
  }
  const line = REPLY_LANGUAGE_REMINDERS[language];
  const last = messages[messages.length - 1];
  if (last && messagePlainText(last).trim() === line) {
    return messages;
  }
  const reminder = {
    role: "user",
    content: line,
    timestamp: Date.now(),
  } as unknown as T;
  return [...messages, reminder];
}

export function installReplyLanguageReminder(params: {
  agent: { transformContext?: ReminderTransform };
  runId: string;
}): () => void {
  const mutableAgent = params.agent;
  const original = mutableAgent.transformContext;
  mutableAgent.transformContext = async (messages, signal) => {
    const transformed = original ? await original.call(mutableAgent, messages, signal) : messages;
    const list = Array.isArray(transformed) ? transformed : messages;
    return appendReplyLanguageReminder(list, getRunReplyLanguage(params.runId));
  };
  return () => {
    mutableAgent.transformContext = original;
  };
}
